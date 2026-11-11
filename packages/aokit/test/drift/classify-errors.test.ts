import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyDrift } from "../../src/drift/classify.ts";
import { hashFileBytes } from "../../src/drift/hash.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function lockfileOf(paths: readonly string[]): Lockfile {
  const hash = hashFileBytes(new TextEncoder().encode("x"));
  return {
    $schema: "https://aokit.andryore.dev/schema/lockfile/v2.json",
    lockfileVersion: 2,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: Object.fromEntries(
      paths.map((path) => [path, { owners: ["m"], mode: "managed" as const, hash }]),
    ),
    deps: {},
  };
}

async function projectDirectory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aokit-classify-errors-"));
  directories.push(dir);
  return dir;
}

test("a tracked path that is a directory fails instead of reading as deleted", async () => {
  const dir = await projectDirectory();
  await mkdir(join(dir, "tracked"));
  const failure = await classifyDrift(dir, lockfileOf(["tracked"])).catch(
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({ code: "EISDIR" });
});

test("a pending-sibling probe that fails for a reason other than absence is not swallowed", async () => {
  const dir = await projectDirectory();
  await writeFile(join(dir, "a.txt"), "x");
  await symlink("a.txt.aokit-new", join(dir, "a.txt.aokit-new"));
  const failure = await classifyDrift(dir, lockfileOf(["a.txt"])).catch((error: unknown) => error);
  expect(failure).toMatchObject({ code: "ELOOP" });
});
