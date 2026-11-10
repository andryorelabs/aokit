import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Git } from "../git/git.ts";

const excludedOutsideGit = new Set(["node_modules", ".git", "dist", ".aokit"]);
const generatedOutsideGit = new Set(["bun.lock", "bun.lockb"]);
const lockfileName = "aokit.lock.json";

function isExcludedOutsideGit(name: string): boolean {
  return excludedOutsideGit.has(name) || name === ".env" || name.startsWith(".env.");
}

function isGeneratedOutsideGit(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return generatedOutsideGit.has(name) || name.endsWith(".tsbuildinfo");
}

async function walk(root: string, relativeDirectory: string): Promise<string[]> {
  const entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !isExcludedOutsideGit(entry.name))
      .map(async (entry) => {
        const relativePath =
          relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
        if (entry.isDirectory()) return walk(root, relativePath);
        return entry.isFile() ? [relativePath] : [];
      }),
  );
  return nested.flat();
}

/**
 * Files in the Project that are not in `known`: from git's untracked, non-ignored list inside a
 * repository, or from a walk with a fixed exclusion list outside one (which also skips `bun.lock`,
 * `bun.lockb` and `*.tsbuildinfo`). Sorted.
 */
export async function findUnknownFiles(
  dir: string,
  known: ReadonlySet<string>,
  git: Git | undefined,
): Promise<string[]> {
  const candidates =
    git === undefined
      ? (await walk(dir, "")).filter((path) => !isGeneratedOutsideGit(path))
      : await git.untrackedPaths(".");
  return candidates.filter((path) => path !== lockfileName && !known.has(path)).toSorted();
}
