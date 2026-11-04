import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { hashTrackedFile } from "../../src/drift/hash.ts";
import { runCreate } from "../../src/create/index.ts";
import { parseLockfile } from "../../src/lockfile/index.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";
import { renderFromLockfile } from "../../src/pipeline/index.ts";

const bundledRegistryPath = join(import.meta.dir, "..", "..", "..", "..", "registry");
const workspaces: string[] = [];

afterAll(() => {
  for (const leftover of workspaces) {
    rmSync(leftover, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-render-"));
  workspaces.push(directory);
  return directory;
}

function trackedHash(path: string, content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return hashTrackedFile(path, bytes);
}

async function createProject(layout: "single" | "monorepo"): Promise<{
  directory: string;
  lockfile: Lockfile;
}> {
  const directory = join(workspace(), "project");
  await runCreate({
    directory,
    layout,
    modules: ["oxc", "knip"],
    answers: [],
    registry: undefined,
    dryRun: false,
    diff: false,
    install: false,
    version: cliVersion,
    env: {},
  });
  const text = readFileSync(join(directory, "aokit.lock.json"), "utf8");
  return { directory, lockfile: parseLockfile(text).lockfile };
}

function options(directory: string) {
  return { projectDir: directory, bundledRegistryPath, cliVersion };
}

async function failure(action: Promise<unknown>): Promise<AokitError> {
  try {
    await action;
  } catch (error) {
    if (error instanceof AokitError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected an AokitError");
}

test.each(["single", "monorepo"] as const)(
  "rendering a created Project's Lockfile reproduces every managed and seed hash (%s)",
  async (layout) => {
    const { directory, lockfile } = await createProject(layout);
    const rendered = await renderFromLockfile(lockfile, options(directory));
    const entries = Object.entries(lockfile.files).filter(([, entry]) => entry.mode !== "ejected");
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, entry] of entries) {
      const file = rendered.plan.vfs.get(path);
      expect(file).toBeDefined();
      if (file === undefined || file.volatile) {
        continue;
      }
      expect(trackedHash(path, file.content)).toBe(entry.hash);
      expect(trackedHash(path, readFileSync(join(directory, path)))).toBe(entry.hash);
    }
    expect(rendered.lockfileText).toBe(readFileSync(join(directory, "aokit.lock.json"), "utf8"));
  },
);

test("a relative Registry source resolves from the Project directory", async () => {
  const { directory, lockfile } = await createProject("single");
  const [name, registry] = Object.entries(lockfile.registries)[0] ?? [];
  if (name === undefined || registry === undefined) throw new Error("no registry");
  const relocated: Lockfile = {
    ...lockfile,
    registries: {
      [name]: { ...registry, source: relative(directory, bundledRegistryPath) },
    },
  };
  const rendered = await renderFromLockfile(relocated, {
    projectDir: directory,
    bundledRegistryPath: join(directory, "does-not-exist"),
    cliVersion,
  });
  expect(rendered.plan.vfs.paths().length).toBeGreaterThan(0);
});

test("a newer minCliVersion fails with MIN_CLI_VERSION before any Registry is read", async () => {
  const { directory, lockfile } = await createProject("single");
  const [name, registry] = Object.entries(lockfile.registries)[0] ?? [];
  if (name === undefined || registry === undefined) throw new Error("no registry");
  const tooNew: Lockfile = {
    ...lockfile,
    registries: {
      [name]: { ...registry, source: "./missing-registry", minCliVersion: "999.0.0" },
    },
  };
  const error = await failure(renderFromLockfile(tooNew, options(directory)));
  expect(error.code).toBe("MIN_CLI_VERSION");
});

test("an absent locked Module version fails naming Module, version and the recopy fix", async () => {
  const { directory, lockfile } = await createProject("single");
  const oxc = lockfile.modules["oxc"];
  if (oxc === undefined) throw new Error("oxc missing");
  const stale: Lockfile = {
    ...lockfile,
    modules: { ...lockfile.modules, oxc: { ...oxc, version: "9.9.9" } },
  };
  const error = await failure(renderFromLockfile(stale, options(directory)));
  expect(error.code).toBe("MODULE_VERSION_UNAVAILABLE");
  expect(error.message).toContain("oxc");
  expect(error.message).toContain("9.9.9");
  expect(error.fix).toContain("aokit recopy");
});

test("versionOverride renders another published version of a Module", async () => {
  const { directory, lockfile } = await createProject("single");
  const oxc = lockfile.modules["oxc"];
  if (oxc === undefined) throw new Error("oxc missing");
  const stale: Lockfile = {
    ...lockfile,
    modules: { ...lockfile.modules, oxc: { ...oxc, version: "9.9.9" } },
  };
  const rendered = await renderFromLockfile(stale, {
    ...options(directory),
    versionOverride: { oxc: oxc.version },
  });
  expect(rendered.lockfile.modules["oxc"]?.version).toBe(oxc.version);
});
