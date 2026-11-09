import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "bumpp";

const aokitManifest = "packages/aokit/package.json";
const createAokitManifest = "packages/create-aokit/package.json";

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
 * `bun run release`: bumps `aokit` and `create-aokit` to one shared version on a release branch
 * and opens a pull request. The `v<version>` tag that triggers `.github/workflows/release.yml` is
 * pushed on the merged commit of `main`.
 */
export default defineConfig({
  files: [aokitManifest, createAokitManifest],
  preid: "next",
  commit: "chore: 🔖 release v%s",
  all: true,
  push: true,
  pr: {
    branch: "chore/release",
    title: "chore: 🔖 release v{version}",
  },
  execute: (operation) => {
    pinCreateAokitDependency(operation.state.newVersion);
  },
});
