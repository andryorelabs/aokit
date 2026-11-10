import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AokitError } from "../cli/envelope.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { hashTrackedFile, volatileHash } from "../drift/hash.ts";
import { openGit } from "./git.ts";

/** Options of {@link assertCleanTree}. */
export interface CleanTreeOptions {
  /** Proceeds despite uncommitted changes (`--allow-dirty`). */
  readonly allowDirty: boolean;
  /** The Project's Lockfile, used outside git to detect edits to files aokit owns. */
  readonly lockfile?: Lockfile | undefined;
}

/** Outcome of {@link assertCleanTree}. */
export interface CleanTreeResult {
  /** Set when the check could not rely on git and no undo is available. */
  readonly warning?: string;
}

const noUndoWarning =
  "Project is not a git repository: no undo is available. Changes to files aokit owns were checked against the Lockfile only.";

async function changedSinceLockfile(dir: string, lockfile: Lockfile): Promise<string[]> {
  const tracked = Object.entries(lockfile.files).filter(
    ([, entry]) => entry.mode !== "ejected" && entry.hash !== volatileHash,
  );
  const checks = tracked.map(async ([path, entry]) => {
    try {
      const bytes = await readFile(join(dir, path));
      const hash = hashTrackedFile(path, bytes);
      return hash === entry.hash ? null : path;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return path;
      throw error;
    }
  });
  const results = await Promise.all(checks);
  return results.filter((path): path is string => path !== null).toSorted();
}

function dirtyTreeError(paths: readonly string[]): AokitError {
  return new AokitError(
    "DIRTY_TREE",
    `The working tree has uncommitted changes: ${paths.join(", ")}`,
    "Commit or stash your changes, or pass --allow-dirty to proceed without an undo.",
  );
}

/**
 * Rejects any uncommitted change before a Plan is built, throwing `DIRTY_TREE` unless `allowDirty`.
 * Outside git it compares Lockfile hashes and returns a "no undo available" warning.
 */
export async function assertCleanTree(
  dir: string,
  options: CleanTreeOptions,
): Promise<CleanTreeResult> {
  const git = await openGit(dir);
  if (git === null) {
    const changed =
      options.lockfile === undefined ? [] : await changedSinceLockfile(dir, options.lockfile);
    if (changed.length > 0 && !options.allowDirty) throw dirtyTreeError(changed);
    return { warning: noUndoWarning };
  }
  const dirty = await git.dirtyPaths();
  if (dirty.length > 0 && !options.allowDirty) throw dirtyTreeError(dirty);
  return {};
}
