import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { z } from "zod";
import { inSequence } from "../apply/sequence.ts";
import { discardStash, restoreStash, type Stash } from "../apply/stash.ts";
import { AokitError } from "../cli/envelope.ts";
import type { Git } from "../git/git.ts";

const markerFileName = "update.json";
const planFileName = "plan.json";
const lockfileName = "aokit.lock.json";

/** Which command left the undo marker; a marker without a kind belongs to `update`. */
export type MarkerKind = "update" | "layout-migrate";

const abortCommands: Record<MarkerKind, string> = {
  update: "aokit update --abort",
  "layout-migrate": "aokit layout migrate --abort",
};

/** What a conflicted update leaves behind so `update --abort` can undo it. */
export const updateMarkerSchema = z.strictObject({
  kind: z.enum(["update", "layout-migrate"]).default("update"),
  stashDirectory: z.string().min(1),
  conflictedPaths: z.array(z.string().min(1)),
  newSiblingPaths: z.array(z.string().min(1)),
  createdPaths: z.array(z.string().min(1)).default([]),
  previousLockfile: z.string(),
});

/** The marker `<git-dir>/aokit/update.json` (`.aokit/update.json` outside git) holds. */
export type UpdateMarker = z.input<typeof updateMarkerSchema>;

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** The directory holding update state: `<git-dir>/aokit`, or `.aokit` outside git. */
async function updateStateDirectory(
  projectDirectory: string,
  git: Git | undefined,
): Promise<string> {
  return git === undefined ? join(projectDirectory, ".aokit") : join(await git.gitDir(), "aokit");
}

/** The absolute path of the saved Plan. */
export async function planFilePath(
  projectDirectory: string,
  git: Git | undefined,
): Promise<string> {
  return join(await updateStateDirectory(projectDirectory, git), planFileName);
}

async function markerPath(projectDirectory: string, git: Git | undefined): Promise<string> {
  return join(await updateStateDirectory(projectDirectory, git), markerFileName);
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (!hasErrnoCode(error, "ENOENT") && !hasErrnoCode(error, "ENOTEMPTY")) {
      throw error;
    }
  }
}

/** Writes `text` to `path` through a sibling temp file, creating the directory when needed. */
export async function writeFileAtomically(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}

/** Writes the marker atomically, creating the state directory when needed. */
export async function writeUpdateMarker(
  projectDirectory: string,
  git: Git | undefined,
  marker: UpdateMarker,
): Promise<void> {
  const parsed = updateMarkerSchema.parse(marker);
  await writeFileAtomically(
    await markerPath(projectDirectory, git),
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
}

/** The marker of an update in progress, or `null` when there is none. */
export async function readUpdateMarker(
  projectDirectory: string,
  git: Git | undefined,
): Promise<z.output<typeof updateMarkerSchema> | null> {
  const path = await markerPath(projectDirectory, git);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) return null;
    throw error;
  }
  try {
    return updateMarkerSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new AokitError(
      "IO_ERROR",
      `The update marker ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      `Delete ${path} and run "aokit doctor", or restore the files from the stash by hand.`,
    );
  }
}

async function stashedPaths(stashDirectory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(stashDirectory, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) {
      throw new AokitError(
        "IO_ERROR",
        `The stash ${stashDirectory} of the update in progress is missing.`,
        "Restore the Project from version control, then delete the update marker.",
      );
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(stashDirectory, join(entry.parentPath, entry.name)))
    .toSorted();
}

async function clearStages(git: Git | undefined, paths: readonly string[]): Promise<void> {
  if (git === undefined) return;
  await inSequence(paths, (path) => git.clearConflictStages(path));
}

async function removePlan(projectDirectory: string, git: Git | undefined): Promise<boolean> {
  const path = await planFilePath(projectDirectory, git);
  try {
    await readFile(path);
  } catch (error) {
    if (hasErrnoCode(error, "ENOENT")) return false;
    throw error;
  }
  await rm(path, { force: true });
  return true;
}

/**
 * Undoes an update: deletes the saved Plan, clears index stages of the conflicted paths, puts the
 * stashed originals and the previous Lockfile back, deletes the files the update created and its
 * `.aokit-new` files, then removes the stash and the marker. Returns the restored paths, or `null`
 * when there was nothing to abort.
 */
export async function abortUpdate(
  projectDirectory: string,
  git: Git | undefined,
  kind: MarkerKind = "update",
): Promise<{ restored: string[] } | null> {
  const marker = await readUpdateMarker(projectDirectory, git);
  if (marker !== null && marker.kind !== kind) {
    throw new AokitError(
      "INVALID_INPUT",
      `The undo marker in progress belongs to a ${marker.kind === "update" ? "update" : "layout migration"}, not to this command.`,
      `Run "${abortCommands[marker.kind]}" to undo it.`,
    );
  }
  const hadPlan = await removePlan(projectDirectory, git);
  const stateDirectory = await updateStateDirectory(projectDirectory, git);
  if (marker === null) {
    await removeEmptyDirectory(stateDirectory);
    return hadPlan ? { restored: [] } : null;
  }
  const restored = await stashedPaths(marker.stashDirectory);
  const stash: Stash = { directory: marker.stashDirectory, stashed: new Set(restored) };
  await clearStages(git, marker.conflictedPaths);
  await restoreStash(projectDirectory, stash, [...marker.createdPaths, ...marker.newSiblingPaths]);
  await writeFile(join(projectDirectory, lockfileName), marker.previousLockfile);
  await discardStash(projectDirectory, git, stash);
  await rm(await markerPath(projectDirectory, git), { force: true });
  await removeEmptyDirectory(stateDirectory);
  return { restored: restored.filter((path) => path !== lockfileName) };
}
