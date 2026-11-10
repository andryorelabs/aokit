import { join } from "node:path";
import { lintPackage } from "./lint.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const commonEntries = ["package.json", "README.md", "LICENSE", "dist/"];

await lintPackage(repoRoot, join(repoRoot, "packages", "aokit"), [...commonEntries, "registry/"]);
await lintPackage(repoRoot, join(repoRoot, "packages", "create-aokit"), commonEntries);
await lintPackage(repoRoot, join(repoRoot, "packages", "module", "dist"), [
  "package.json",
  "README.md",
  "LICENSE",
  "index.js",
  "index.d.ts",
]);
