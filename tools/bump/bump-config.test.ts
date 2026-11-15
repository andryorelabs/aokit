import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config from "../../bump.config.ts";

interface ReleaseConfig {
  readonly files: readonly string[];
  readonly pr: { readonly branch: string; readonly base: string; readonly title: string };
  readonly execute: (operation: { state: { newVersion: string } }) => void;
}

function isReleaseConfig(value: unknown): value is ReleaseConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "files" in value &&
    "pr" in value &&
    "execute" in value &&
    typeof value.execute === "function"
  );
}

function releaseConfig(): ReleaseConfig {
  const value: unknown = config;
  if (!isReleaseConfig(value)) throw new Error("bump.config.ts has an unexpected shape");
  return value;
}

let workspace: string;
let originalDirectory: string;

beforeEach(() => {
  originalDirectory = process.cwd();
  workspace = mkdtempSync(join(tmpdir(), "aokit-bump-"));
  writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "root", private: true }));
  mkdirSync(join(workspace, "packages", "create-aokit"), { recursive: true });
  writeFileSync(
    join(workspace, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A fix.\n\n## [1.0.0] - 2026-01-01\n\n### Added\n\n- First.\n\n[Unreleased]: https://example.test/compare/v1.0.0...HEAD\n[1.0.0]: https://example.test/releases/tag/v1.0.0\n",
  );
  process.chdir(workspace);
});

afterEach(() => {
  process.chdir(originalDirectory);
  rmSync(workspace, { recursive: true, force: true });
});

describe("release bump config", () => {
  test("bumps the three published manifests on a release branch", () => {
    expect(releaseConfig().files).toEqual([
      "packages/aokit/package.json",
      "packages/create-aokit/package.json",
      "packages/module/package.json",
    ]);
    expect(releaseConfig().pr.branch).toBe("chore/release");
  });

  test("opens the release pull request against develop", () => {
    expect(releaseConfig().pr.base).toBe("develop");
  });

  test("execute pins the aokit dependency of create-aokit to the new version", () => {
    const manifest = join(workspace, "packages", "create-aokit", "package.json");
    writeFileSync(
      manifest,
      JSON.stringify({ name: "create-aokit", version: "1.0.0", dependencies: {} }).replace(
        '"dependencies":{}',
        '"dependencies":{"aokit":"1.0.0"}',
      ),
    );
    releaseConfig().execute({ state: { newVersion: "1.2.3" } });
    expect(readFileSync(manifest, "utf8")).toContain('"aokit":"1.2.3"');
  }, 60_000);

  test("execute moves the Unreleased entries into a dated section with compare links", () => {
    writeFileSync(
      join(workspace, "packages", "create-aokit", "package.json"),
      JSON.stringify({ name: "create-aokit", dependencies: { aokit: "1.0.0" } }),
    );
    releaseConfig().execute({ state: { newVersion: "1.1.0" } });
    const changelog = readFileSync(join(workspace, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(
      /## \[Unreleased\]\n\n## \[1\.1\.0\] - \d{4}-\d{2}-\d{2}\n\n### Fixed/,
    );
    expect(changelog).toContain("[Unreleased]: https://example.test/compare/v1.1.0...HEAD");
    expect(changelog).toContain("[1.1.0]: https://example.test/compare/v1.0.0...v1.1.0");
  }, 60_000);

  test("execute fails when create-aokit has no aokit dependency to pin", () => {
    writeFileSync(
      join(workspace, "packages", "create-aokit", "package.json"),
      JSON.stringify({ name: "create-aokit" }),
    );
    expect(() => releaseConfig().execute({ state: { newVersion: "1.2.3" } })).toThrow(
      /no "aokit" dependency/,
    );
  });
});
