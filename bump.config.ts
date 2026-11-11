import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "bumpp";

const aokitManifest = "packages/aokit/package.json";
const createAokitManifest = "packages/create-aokit/package.json";
const moduleManifest = "packages/module/package.json";

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
 * `bun run release`: bumps `aokit`, `create-aokit` and `@aokit/module` to one shared version on a release branch
 * and opens a pull request. The `v<version>` tag that triggers `.github/workflows/release.yml` is
 * pushed on the promotion merge commit on `main`: the release pull request lands on `develop`, then a
 * pull request from `develop` to `main` is merged with a merge commit. That workflow fails unless `CHANGELOG.md` has a non-empty
 * `## [<version>]` section, so the release pull request also moves the `[Unreleased]` entries into
 * it.
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
    pinCreateAokitDependency(operation.state.newVersion);
  },
});
