import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyDrift } from "../../src/drift/classify.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const emptyLockfile: Lockfile = {
  $schema: "https://aokit.andryore.dev/schema/lockfile/v2.json",
  lockfileVersion: 2,
  cliVersion: "0.0.0",
  protocolVersion: 1,
  layout: "single",
  registries: {},
  modules: {},
  files: {},
  deps: {},
};

test("outside git bun.lock, bun.lockb and tsbuildinfo files are not unknown, other new files are", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aokit-unknown-"));
  directories.push(dir);
  await mkdir(join(dir, "packages", "app"), { recursive: true });
  await Promise.all(
    ["bun.lock", "bun.lockb", "tsconfig.tsbuildinfo", "packages/app/x.tsbuildinfo", "new.ts"].map(
      (path) => writeFile(join(dir, path), "x"),
    ),
  );
  const report = await classifyDrift(dir, emptyLockfile);
  expect(report.files).toEqual([{ path: "new.ts", state: "unknown" }]);
});
