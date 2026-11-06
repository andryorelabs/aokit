import { expect, test } from "bun:test";
import { access, constants, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildPackage } from "./build.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const packageDirectory = join(repoRoot, "packages", "aokit");

test("buildPackage emits an executable bundle with the shebang and a Registry copy", async () => {
  await buildPackage(packageDirectory, join(repoRoot, "registry"));
  const bundlePath = join(packageDirectory, "dist", "cli.js");
  const bundle = await readFile(bundlePath, "utf8");
  expect(bundle.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  await access(bundlePath, constants.X_OK);
  expect(bundle).not.toMatch(/from\s*["']@aokit\/module["']/);
  expect((await stat(join(packageDirectory, "registry", "index.json"))).isFile()).toBe(true);
  expect(await readFile(join(packageDirectory, "registry", "index.json"), "utf8")).toBe(
    await readFile(join(repoRoot, "registry", "index.json"), "utf8"),
  );
}, 120_000);

async function readManifest(path: string): Promise<Record<string, unknown>> {
  const manifest: unknown = await Bun.file(path).json();
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`${path} is not a JSON object.`);
  }
  return Object.fromEntries(Object.entries(manifest));
}

test("create-aokit has the version of aokit and depends on exactly that version", async () => {
  const aokit = await readManifest(join(packageDirectory, "package.json"));
  const createAokit = await readManifest(
    join(repoRoot, "packages", "create-aokit", "package.json"),
  );
  expect(createAokit["version"]).toBe(aokit["version"]);
  expect(createAokit["dependencies"]).toMatchObject({ aokit: aokit["version"] });
});
