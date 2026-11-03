import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  rmdir,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Git } from "../git/git.ts";
import { openGit } from "../git/index.ts";
import { inSequence } from "./sequence.ts";

/** A directory holding the originals of every file one apply may overwrite or delete. */
export interface Stash {
  readonly directory: string;
  /** Project-relative paths whose originals were copied into the stash. */
  readonly stashed: ReadonlySet<string>;
}

function hasErrnoCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && "code" in error && codes.includes(String(error.code));
}

/**
 * The directory holding a Project's stashes. Inside git it is keyed by the Project directory, so
 * several Projects sharing one git dir never see or remove each other's stashes.
 */
export async function stashRoot(projectDirectory: string, git: Git | undefined): Promise<string> {
  if (git === undefined) return join(projectDirectory, ".aokit", "stash");
  const key = createHash("sha256")
    .update(await realpath(projectDirectory))
    .digest("hex")
    .slice(0, 12);
  return join(await git.gitDir(), "aokit", "stash", key);
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (!hasErrnoCode(error, "ENOENT", "ENOTEMPTY", "EEXIST")) {
      throw error;
    }
  }
}

async function pruneStashRoot(
  root: string,
  projectDirectory: string,
  git: Git | undefined,
): Promise<void> {
  await removeEmptyDirectory(root);
  if (git === undefined) {
    await removeEmptyDirectory(join(projectDirectory, ".aokit"));
    return;
  }
  await removeEmptyDirectory(dirname(root));
  await removeEmptyDirectory(dirname(dirname(root)));
}

/** Copies the existing regular file at each of `paths` into a fresh timestamped stash directory. */
export async function createStash(
  projectDirectory: string,
  git: Git | undefined,
  paths: readonly string[],
): Promise<Stash> {
  const root = await stashRoot(projectDirectory, git);
  await mkdir(root, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const directory = await mkdtemp(join(root, `${stamp}-`));
  const stashed = new Set<string>();
  await inSequence(paths, async (path) => {
    const source = join(projectDirectory, path);
    const stats = await lstat(source).catch((error: unknown) => {
      if (hasErrnoCode(error, "ENOENT", "ENOTDIR")) return null;
      throw error;
    });
    if (stats === null || !stats.isFile()) return;
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    await chmod(destination, stats.mode & 0o7777);
    stashed.add(path);
  });
  return { directory, stashed };
}

/**
 * Puts every stashed original back byte-identically with its mode and deletes the files in
 * `created` that did not exist before the commit.
 */
export async function restoreStash(
  projectDirectory: string,
  stash: Stash,
  created: readonly string[],
): Promise<void> {
  await inSequence(created, (path) => rm(join(projectDirectory, path), { force: true }));
  await inSequence([...stash.stashed], async (path) => {
    const source = join(stash.directory, path);
    const destination = join(projectDirectory, path);
    const { mode } = await lstat(source);
    await mkdir(dirname(destination), { recursive: true });
    await rm(destination, { force: true });
    await copyFile(source, destination);
    await chmod(destination, mode & 0o7777);
  });
}

/** Removes a stash directory after a successful apply, and its parents when they are empty. */
export async function discardStash(
  projectDirectory: string,
  git: Git | undefined,
  stash: Stash,
): Promise<void> {
  await rm(stash.directory, { recursive: true, force: true });
  await pruneStashRoot(await stashRoot(projectDirectory, git), projectDirectory, git);
}

async function listStashes(projectDirectory: string, git: Git | undefined): Promise<string[]> {
  const root = await stashRoot(projectDirectory, git);
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
      .toSorted();
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) return [];
    throw error;
  }
}

/** Absolute paths of stashes an interrupted or failed apply left behind, oldest first. */
export async function findLeftoverStash(projectDirectory: string): Promise<string[]> {
  return listStashes(projectDirectory, (await openGit(projectDirectory)) ?? undefined);
}

/** Deletes every leftover stash of the Project and returns the paths it removed. */
export async function removeLeftoverStash(projectDirectory: string): Promise<string[]> {
  const git = (await openGit(projectDirectory)) ?? undefined;
  const stashes = await listStashes(projectDirectory, git);
  await inSequence(stashes, (stash) => rm(stash, { recursive: true, force: true }));
  await pruneStashRoot(await stashRoot(projectDirectory, git), projectDirectory, git);
  return stashes;
}
