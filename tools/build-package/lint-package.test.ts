import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintPackage, packedPathsOf } from "./lint.ts";

const posixTest = process.platform === "win32" ? test.skip : test;

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((path) => rm(path, { recursive: true, force: true })));
});

async function stage(toolExitCode: number): Promise<{ repoRoot: string; packageDir: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), "aokit-lint-package-"));
  roots.push(repoRoot);
  const binDirectory = join(repoRoot, "node_modules", ".bin");
  await mkdir(binDirectory, { recursive: true });
  await Promise.all(
    ["publint", "attw"].map(async (tool) => {
      const path = join(binDirectory, tool);
      await writeFile(path, `#!/bin/sh\necho ${tool} output\nexit ${toolExitCode}\n`);
      await chmod(path, 0o755);
    }),
  );
  const packageDir = join(repoRoot, "pkg");
  await mkdir(packageDir);
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "lint-fixture", version: "1.0.0", files: ["index.js"] }),
  );
  await writeFile(join(packageDir, "index.js"), "export {};\n");
  return { repoRoot, packageDir };
}

test("packedPathsOf lists the files npm would pack", async () => {
  const { packageDir } = await stage(0);
  const paths = await packedPathsOf(packageDir);
  expect(paths).toContain("package.json");
  expect(paths).toContain("index.js");
}, 60_000);

test("packedPathsOf fails when the package cannot be packed", async () => {
  const { repoRoot } = await stage(0);
  const failure = await packedPathsOf(join(repoRoot, "missing")).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
});

posixTest("lintPackage passes when the tools pass and every required entry is packed", async () => {
  const { repoRoot, packageDir } = await stage(0);
  await lintPackage(repoRoot, packageDir, ["package.json", "index.js"]);
});

posixTest("lintPackage fails and names the entries missing from the tarball", async () => {
  const { repoRoot, packageDir } = await stage(0);
  const failure = await lintPackage(repoRoot, packageDir, ["dist/"]).catch(
    (error: unknown) => error,
  );
  expect(String(failure)).toContain("tarball lacks: dist/");
});

posixTest("lintPackage fails when a lint tool exits non-zero", async () => {
  const { repoRoot, packageDir } = await stage(1);
  const failure = await lintPackage(repoRoot, packageDir, []).catch((error: unknown) => error);
  expect(String(failure)).toMatch(/publint.*failed/s);
});
