import { expect, test } from "bun:test";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { resolveRegistrySource } from "../../src/project/registry.ts";

const context = { projectDir: join("/work", "app"), bundledRegistryPath: join("/opt", "registry") };

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
  expect(resolveRegistrySource("../registry", context)).toBe(join("/work", "registry"));
});

test("an absolute source is kept as is", () => {
  expect(resolveRegistrySource("/srv/registry", context)).toBe("/srv/registry");
});

test("a URL source throws INVALID_INPUT with a fix", () => {
  const thrown = thrownBy(() => resolveRegistrySource("https://example.com/registry", context));
  expect(thrown).toBeInstanceOf(AokitError);
  expect(thrown).toMatchObject({ code: "INVALID_INPUT" });
  expect(thrown instanceof AokitError && thrown.fix.length > 0).toBe(true);
});
