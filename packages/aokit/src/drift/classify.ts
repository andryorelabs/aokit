import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Git } from "../git/git.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { hashFileBytes, volatileHash } from "./hash.ts";
import { findUnknownFiles } from "./unknown.ts";

/** How a file in the working tree relates to the Lockfile. */
type DriftState = "pristine" | "modified" | "deleted" | "unknown" | "volatile";

/** One file and its Drift state. */
export interface DriftEntry {
  readonly path: string;
  readonly state: DriftState;
}

/** The Drift state of every Lockfile file and of every unknown file, sorted by path. */
export interface DriftReport {
  readonly files: readonly DriftEntry[];
}

/** Options of {@link classifyDrift}. */
export interface ClassifyDriftOptions {
  /** The git adapter for the Project; omitted outside a repository. */
  readonly git?: Git | undefined;
}

const newSuffix = ".aokit-new";

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function classifyFile(
  dir: string,
  path: string,
  entry: Lockfile["files"][string],
): Promise<DriftState> {
  if (entry.mode === "ejected") return "pristine";
  let bytes: Uint8Array;
  try {
    bytes = await readFile(join(dir, path));
  } catch (error) {
    if (isMissing(error)) return "deleted";
    throw error;
  }
  if (entry.hash === volatileHash) return "volatile";
  return hashFileBytes(bytes) === entry.hash ? "pristine" : "modified";
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function pendingNewSiblings(dir: string, lockfile: Lockfile): Promise<string[]> {
  const siblings = Object.keys(lockfile.files).map((path) => `${path}${newSuffix}`);
  const present = await Promise.all(siblings.map((path) => exists(join(dir, path))));
  return siblings.filter((_, index) => present[index] === true);
}

/**
 * Classifies every Lockfile file as `pristine`, `modified`, `deleted` or `volatile` by comparing
 * LF-normalized content hashes, and reports files outside the Lockfile (including `.aokit-new`
 * files) as `unknown`. Ejected files report no drift. Reads only; writes nothing.
 */
export async function classifyDrift(
  dir: string,
  lockfile: Lockfile,
  options: ClassifyDriftOptions = {},
): Promise<DriftReport> {
  const known = new Set(Object.keys(lockfile.files));
  const [locked, unknown, siblings] = await Promise.all([
    Promise.all(
      Object.entries(lockfile.files).map(async ([path, entry]): Promise<DriftEntry> => ({
        path,
        state: await classifyFile(dir, path, entry),
      })),
    ),
    findUnknownFiles(dir, known, options.git),
    pendingNewSiblings(dir, lockfile),
  ]);
  const unknownPaths = [...new Set([...unknown, ...siblings])];
  const files = [
    ...locked,
    ...unknownPaths.map((path): DriftEntry => ({ path, state: "unknown" })),
  ].toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { files };
}

/** Whether `path` is a `.aokit-new` sibling a Conflict left behind. */
export function isNewSibling(path: string): boolean {
  return path.endsWith(newSuffix);
}
