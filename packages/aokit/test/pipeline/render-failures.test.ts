import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { cliVersion } from "../../src/cli/version.ts";
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

async function createProject(): Promise<{ directory: string; lockfile: Lockfile }> {
  const root = mkdtempSync(join(tmpdir(), "aokit-render-failures-"));
  workspaces.push(root);
  const directory = join(root, "project");
  await runCreate({
    directory,
    layout: "single",
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

test("a locked Module whose Registry is not opened fails with INVALID_INPUT", async () => {
  const { directory, lockfile } = await createProject();
  const error = await failure(
    renderFromLockfile(lockfile, {
      projectDir: directory,
      bundledRegistryPath,
      cliVersion,
      registries: new Map(),
    }),
  );
  expect(error.code).toBe("INVALID_INPUT");
  expect(error.message).toContain("aokit.lock.json does not list");
  expect(error.fix).toContain("Restore aokit.lock.json");
});

test("a Lockfile with no Modules and no Registry fails with INVALID_INPUT", async () => {
  const { directory, lockfile } = await createProject();
  const empty: Lockfile = { ...lockfile, modules: {}, registries: {}, files: {} };
  const error = await failure(
    renderFromLockfile(empty, {
      projectDir: directory,
      bundledRegistryPath,
      cliVersion,
      registries: new Map(),
    }),
  );
  expect(error.code).toBe("INVALID_INPUT");
  expect(error.message).toBe("aokit.lock.json lists no Registry.");
});

test("a locked selection whose requirement no locked Module provides fails to resolve", async () => {
  const { directory, lockfile } = await createProject();
  const { oxc: _removed, ...withoutOxc } = lockfile.modules;
  const broken: Lockfile = { ...lockfile, modules: withoutOxc };
  const error = await failure(
    renderFromLockfile(broken, { projectDir: directory, bundledRegistryPath, cliVersion }),
  );
  expect(error).toBeInstanceOf(AokitError);
  expect(error.message).not.toBe("");
});
