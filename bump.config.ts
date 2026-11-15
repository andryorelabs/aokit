import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "bumpp";
import { promoteUnreleased } from "./tools/release/promote-unreleased.ts";

const aokitManifest = "packages/aokit/package.json";
const createAokitManifest = "packages/create-aokit/package.json";
const moduleManifest = "packages/module/package.json";
const changelogPath = "CHANGELOG.md";

/**
 * Pins `create-aokit`'s dependency on `aokit` to the new shared version and refreshes `bun.lock`,
 * so the release commit installs with `--frozen-lockfile`.
 */
function pinCreateAokitDependency(newVersion: string): void {
  const text = readFileSync(createAokitManifest, "utf8");
  const aokitDependency = /("aokit":\s*")[^"]+(")/;
  if (!aokitDependency.test(text)) {
    throw new Error(`${createAokitManifest} has no "aokit" dependency to pin to ${newVersion}`);
  }
  writeFileSync(createAokitManifest, text.replace(aokitDependency, `$1${newVersion}$2`));
  execFileSync("bun", ["install"], { stdio: "inherit" });
}

/**
 * Moves the `[Unreleased]` entries of `CHANGELOG.md` into a section for the new version dated
 * today (UTC), with its compare links, so the release commit carries the notes the release
 * workflow requires.
 */
function promoteChangelog(newVersion: string): void {
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(
    changelogPath,
    promoteUnreleased(readFileSync(changelogPath, "utf8"), newVersion, date),
  );
}

/**
 * `bun run release`: bumps `aokit`, `create-aokit` and `@aokit/module` to one shared version on a release branch
 * and opens a pull request. The `v<version>` tag that triggers `.github/workflows/release.yml` is
 * pushed on the promotion merge commit on `main`: the release pull request lands on `develop`, then a
 * pull request from `develop` to `main` is merged with a merge commit. That workflow fails unless `CHANGELOG.md` has a non-empty
 * `## [<version>]` section, so the release pull request also moves the `[Unreleased]` entries into
 * it (`promoteChangelog`).
 */
export default defineConfig({
  files: [aokitManifest, createAokitManifest, moduleManifest],
  preid: "next",
  commit: "chore: 🔖 release v%s",
  all: true,
  push: true,
  pr: {
    branch: "chore/release",
    base: "develop",
    title: "chore: 🔖 release v{version}",
  },
  execute: (operation) => {
    promoteChangelog(operation.state.newVersion);
    pinCreateAokitDependency(operation.state.newVersion);
  },
});
