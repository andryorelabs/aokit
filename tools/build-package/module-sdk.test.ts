import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { packedPathsOf } from "./lint.ts";
import { buildModuleSdk, publishManifestOf, rewriteRelativeTsSpecifiers } from "./module-sdk.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const moduleDirectory = join(repoRoot, "packages", "module");
const stagedDirectory = join(moduleDirectory, "dist");
const typescriptCompiler = join(repoRoot, "node_modules", "typescript7", "bin", "tsc");

async function run(command: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${stdout}${stderr}`);
  }
  return stdout;
}

test("rewriteRelativeTsSpecifiers points relative .ts specifiers at the emitted .js", () => {
  const source = [
    'export { a } from "./a.ts";',
    'import type { B } from "../b.ts";',
    'type C = import("./c.ts").C;',
    'import { z } from "zod";',
    'export { d } from "./d.tsx-like";',
  ].join("\n");
  expect(rewriteRelativeTsSpecifiers(source)).toBe(
    [
      'export { a } from "./a.js";',
      'import type { B } from "../b.js";',
      'type C = import("./c.js").C;',
      'import { z } from "zod";',
      'export { d } from "./d.tsx-like";',
    ].join("\n"),
  );
});

test("publishManifestOf promotes publishConfig.exports relative to the staged dist", () => {
  const manifest = publishManifestOf({
    name: "@aokit/module",
    version: "1.2.3",
    files: ["dist"],
    exports: { ".": "./src/index.ts" },
    scripts: { test: "bun test" },
    devDependencies: { typescript: "1" },
    publishConfig: {
      access: "public",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    },
  });
  expect(manifest).toEqual({
    name: "@aokit/module",
    version: "1.2.3",
    files: ["*.js", "*.d.ts"],
    exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
    publishConfig: { access: "public" },
  });
});

test("publishManifestOf refuses a manifest without publishConfig.exports", () => {
  expect(() => publishManifestOf({ name: "x", publishConfig: { access: "public" } })).toThrow(
    "publishConfig.exports",
  );
});

test("@aokit/module shares the version of aokit and its publishConfig.exports point to dist", async () => {
  const aokit: unknown = await Bun.file(join(repoRoot, "packages", "aokit", "package.json")).json();
  const sdk: unknown = await Bun.file(join(moduleDirectory, "package.json")).json();
  expect(aokit).toHaveProperty("version");
  const aokitVersion: unknown =
    typeof aokit === "object" && aokit !== null && "version" in aokit ? aokit.version : undefined;
  expect(sdk).toMatchObject({
    version: aokitVersion,
    files: ["dist"],
    publishConfig: {
      access: "public",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
    },
  });
  expect(sdk).not.toHaveProperty("private");
});

/**
 * Skipped on Windows: staging and consuming the package exec the extensionless typescript7
 * `bin/tsc` script, `npm` (a `.cmd` shim there) and `tar` directly, and symlink a directory.
 * The package is only built and published from Linux runners.
 */
describe.skipIf(process.platform === "win32")("the staged @aokit/module package", () => {
  beforeAll(async () => {
    await buildModuleSdk(repoRoot, moduleDirectory);
  }, 120_000);

  test("the packed tarball holds JS and .d.ts only, besides the npm documents", async () => {
    const packed = await packedPathsOf(stagedDirectory);
    expect(packed).toContain("index.js");
    expect(packed).toContain("index.d.ts");
    const documents = new Set(["package.json", "README.md", "LICENSE"]);
    const code = packed.filter((path) => !documents.has(path));
    for (const path of code) {
      expect(path.endsWith(".js") || path.endsWith(".d.ts")).toBe(true);
      expect(path).not.toMatch(/(^|\/)(src|test)\//);
      expect(path).not.toMatch(/\.test\./);
    }
    const declarations = await readFile(join(stagedDirectory, "index.d.ts"), "utf8");
    expect(declarations).not.toMatch(/\.ts["']/);
  }, 120_000);

  test("a TypeScript consumer imports defineModule from the packed tarball with types", async () => {
    const consumer = await mkdtemp(join(tmpdir(), "aokit-module-consumer-"));
    const tarballName = (
      await run(["npm", "pack", "--pack-destination", consumer], stagedDirectory)
    ).trim();
    const installed = join(consumer, "node_modules", "@aokit", "module");
    await mkdir(installed, { recursive: true });
    await run(
      ["tar", "-xzf", join(consumer, tarballName), "-C", installed, "--strip-components=1"],
      consumer,
    );
    const zodPackage = dirname(Bun.resolveSync("zod/package.json", moduleDirectory));
    await symlink(zodPackage, join(consumer, "node_modules", "zod"));
    await writeFile(join(consumer, "package.json"), '{ "type": "module" }\n');
    await writeFile(
      join(consumer, "consumer.ts"),
      [
        'import { defineModule } from "@aokit/module";',
        "",
        'export const module = defineModule({ name: "consumer", version: "1.0.0", description: "Consumer fixture.", ops: [] });',
        'export const name: "consumer" = module.name;',
        "// @ts-expect-error -- a Module needs a version, so the types are real",
        'export const invalid = defineModule({ name: "broken", description: "Broken fixture.", ops: [] });',
        "",
      ].join("\n"),
    );
    await run(
      [
        typescriptCompiler,
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "esnext",
        "--types",
        "",
        "consumer.ts",
      ],
      consumer,
    );
    const imported: unknown = await import(join(installed, "index.js"));
    expect(imported).toHaveProperty("defineModule");
  }, 120_000);
});
