import { expect, test } from "bun:test";
import { access, constants, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExitCode as SourceExitCode } from "../../packages/aokit/src/cli/exit-codes.ts";
import type {
  run as sourceRun,
  RunOptions as SourceRunOptions,
} from "../../packages/aokit/src/cli/run.ts";
import type {
  ExitCode as DeclaredExitCode,
  run as declaredRun,
  RunOptions as DeclaredRunOptions,
} from "./assets/run.d.ts";
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

type MutuallyAssignable<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false;

test("dist/run.d.ts declares the same run, RunOptions and ExitCode as the source", () => {
  const sameRun: MutuallyAssignable<typeof declaredRun, typeof sourceRun> = true;
  const sameOptions: MutuallyAssignable<DeclaredRunOptions, SourceRunOptions> = true;
  const sameExitCode: MutuallyAssignable<DeclaredExitCode, SourceExitCode> = true;
  expect([sameRun, sameOptions, sameExitCode]).toEqual([true, true, true]);
});

const publishedPackageDirectories = ["aokit", "create-aokit", "module"] as const;
const metadataFields = ["description", "homepage", "bugs", "author"] as const;

test.each(publishedPackageDirectories)(
  "package %s carries non-empty npm metadata",
  async (directory) => {
    const parsed: unknown = await Bun.file(
      join(repoRoot, "packages", directory, "package.json"),
    ).json();
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError(`package.json of ${directory} is not an object`);
    }
    const manifest = new Map<string, unknown>(Object.entries(parsed));
    for (const field of metadataFields) {
      expect(typeof manifest.get(field) === "string" && manifest.get(field) !== "").toBe(true);
    }
    const keywords = manifest.get("keywords");
    expect(Array.isArray(keywords) && keywords.length > 0).toBe(true);
    expect(JSON.stringify(manifest.get("repository"))).toContain("andryorelabs/aokit");
  },
);

test.each(["aokit.md", "create-aokit.md", "module.md"])(
  "npm README source %s uses only absolute image URLs",
  async (fileName) => {
    const source = await readFile(join(import.meta.dir, "assets", fileName), "utf8");
    const imageSources = [...source.matchAll(/!\[[^\]]*\]\(([^)\s]+)|<img[^>]+src="([^"]+)"/g)].map(
      (match) => match[1] ?? match[2] ?? "",
    );
    expect(imageSources.length).toBeGreaterThan(0);
    for (const imageSource of imageSources) {
      expect(imageSource.startsWith("https://")).toBe(true);
    }
  },
);
