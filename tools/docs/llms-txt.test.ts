import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const packagesDirectory = join(repoRoot, "packages");

interface PublishedPackage {
  readonly name: string;
  readonly directory: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function listPublishedPackages(): PublishedPackage[] {
  return readdirSync(packagesDirectory).flatMap((directoryName) => {
    const manifestPath = join(packagesDirectory, directoryName, "package.json");
    if (!existsSync(manifestPath)) return [];
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!isRecord(manifest)) return [];
    const { name, private: isPrivate } = manifest;
    if (isPrivate === true || typeof name !== "string") return [];
    return [
      {
        name,
        directory: join(packagesDirectory, directoryName),
      },
    ];
  });
}

const publishedPackages = listPublishedPackages();
const rootIndex = readFileSync(join(repoRoot, "llms.txt"), "utf8");

describe("llms.txt per published package", () => {
  test("finds the published packages", () => {
    expect(publishedPackages.length).toBeGreaterThanOrEqual(3);
  });

  for (const published of publishedPackages) {
    describe(published.name, () => {
      test("has an llms.txt", () => {
        expect(existsSync(join(published.directory, "llms.txt"))).toBe(true);
      });

      test("is linked from the root llms.txt index", () => {
        expect(rootIndex).toContain(`(https://www.npmjs.com/package/${published.name})`);
        expect(rootIndex).toContain(`packages/${basename(published.directory)}/llms.txt`);
      });
    });
  }
});
