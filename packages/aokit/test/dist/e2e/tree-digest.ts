import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ignoredDirectories = new Set([".git", "node_modules"]);

async function collectFiles(root: string, directory: string, found: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- ordered walk
        await collectFiles(root, absolute, found);
      }
    } else {
      found.push(relative(root, absolute));
    }
  }
}

/** Maps every file of a Project tree (outside `.git` and `node_modules`) to its sha256. */
export async function treeDigests(root: string): Promise<Map<string, string>> {
  const files: string[] = [];
  await collectFiles(root, root, files);
  const digests = new Map<string, string>();
  for (const file of files) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- ordered read
    const content = await readFile(join(root, file));
    digests.set(file, createHash("sha256").update(content).digest("hex"));
  }
  return digests;
}

/** Lists the paths that are missing from one side or differ in content. */
export function differingPaths(left: Map<string, string>, right: Map<string, string>): string[] {
  const paths = new Set([...left.keys(), ...right.keys()]);
  return [...paths].filter((path) => left.get(path) !== right.get(path)).toSorted();
}
