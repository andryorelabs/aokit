import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPackages } from "./build.ts";

const realRoot = join(import.meta.dir, "..", "..");
const sandboxes: string[] = [];

afterAll(async () => {
  await Promise.all(sandboxes.map((path) => rm(path, { recursive: true, force: true })));
});

async function stageRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "aokit-build-packages-"));
  sandboxes.push(root);
  await symlink(join(realRoot, "node_modules"), join(root, "node_modules"));
  await cp(join(realRoot, "LICENSE"), join(root, "LICENSE"));
  await cp(
    join(realRoot, "tools", "build-package", "assets"),
    join(root, "tools", "build-package", "assets"),
    {
      recursive: true,
    },
  );
  await cp(join(realRoot, "packages", "module", "src"), join(root, "packages", "module", "src"), {
    recursive: true,
  });
  await cp(
    join(realRoot, "packages", "module", "package.json"),
    join(root, "packages", "module", "package.json"),
  );
  await symlink(
    join(realRoot, "packages", "module", "node_modules"),
    join(root, "packages", "module", "node_modules"),
  );
  await mkdir(join(root, "packages", "aokit", "src", "cli"), { recursive: true });
  await writeFile(
    join(root, "packages", "aokit", "src", "cli", "main.ts"),
    "console.log('cli');\n",
  );
  await writeFile(
    join(root, "packages", "aokit", "src", "cli", "run.ts"),
    "export const run = 1;\n",
  );
  await mkdir(join(root, "packages", "create-aokit", "src"), { recursive: true });
  await writeFile(
    join(root, "packages", "create-aokit", "src", "main.ts"),
    "console.log('create');\n",
  );
  await mkdir(join(root, "registry"), { recursive: true });
  await writeFile(join(root, "registry", "index.json"), "{}\n");
  return root;
}

test("buildPackages builds the three packages and copies LICENSE and README into each", async () => {
  const root = await stageRepository();
  await buildPackages(root);
  const createBin = await readFile(
    join(root, "packages", "create-aokit", "dist", "main.js"),
    "utf8",
  );
  expect(createBin.startsWith("#!/usr/bin/env node\n")).toBe(true);
  const documents = ["aokit", "create-aokit"].flatMap((packageName) =>
    ["LICENSE", "README.md"].map((name) => join(root, "packages", packageName, name)),
  );
  const stats = await Promise.all(documents.map((path) => stat(path)));
  expect(stats.every((entry) => entry.isFile())).toBe(true);
  expect((await stat(join(root, "packages", "aokit", "dist", "cli.js"))).isFile()).toBe(true);
  expect((await stat(join(root, "packages", "module", "dist", "index.js"))).isFile()).toBe(true);
}, 120_000);

test("buildPackages reports a bundling failure", async () => {
  const root = await stageRepository();
  await writeFile(
    join(root, "packages", "create-aokit", "src", "main.ts"),
    "import './missing.ts';\n",
  );
  const failure = await buildPackages(root).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
}, 120_000);
