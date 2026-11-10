import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AokitError } from "../../src/cli/envelope.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";
import { openProjectRegistry, resolveRegistrySource } from "../../src/project/registry.ts";
import { bundledRegistryPath } from "../../src/registry/bundled.ts";

const workDirectory = resolve("/work");
const serveDirectory = resolve("/srv/registry");
const context = {
  projectDir: join(workDirectory, "app"),
  bundledRegistryPath: join(resolve("/opt"), "registry"),
};

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }
  return undefined;
}

test("bundled resolves to the shipped Registry", () => {
  expect(resolveRegistrySource("bundled", context)).toBe(context.bundledRegistryPath);
});

test("a relative source resolves from the Project directory", () => {
  expect(resolveRegistrySource("../registry", context)).toBe(join(workDirectory, "registry"));
});

test("an absolute source is kept as is", () => {
  expect(resolveRegistrySource(serveDirectory, context)).toBe(serveDirectory);
});

test("a file: URL resolves to its local directory, as the Registry client reads it", () => {
  expect(resolveRegistrySource(pathToFileURL(serveDirectory).href, context)).toBe(serveDirectory);
});

test("an https URL and a github source are rejected until the commands read remote Registries", () => {
  for (const source of ["https://registry.example.test", "github:acme/modules#main"]) {
    const thrown = thrownBy(() => resolveRegistrySource(source, context));
    expect(thrown).toBeInstanceOf(AokitError);
    expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
  }
});

test("the bundled Registry path is the shipped registry directory", () => {
  expect(bundledRegistryPath.endsWith("registry")).toBe(true);
});

test("openProjectRegistry rejects a Lockfile that lists no Registry", async () => {
  const lockfile: Lockfile = {
    $schema: "",
    lockfileVersion: 2,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: {},
    deps: {},
  };
  const options = { projectDir: context.projectDir, cliVersion: "0.0.0" };
  const thrown = await openProjectRegistry(lockfile, options).catch((error: unknown) => error);
  expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
});

test("a URL source throws INVALID_INPUT with a fix", () => {
  const thrown = thrownBy(() => resolveRegistrySource("https://example.com/registry", context));
  expect(thrown).toBeInstanceOf(AokitError);
  expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
  expect(thrown instanceof AokitError && thrown.fix.length > 0).toBe(true);
});
