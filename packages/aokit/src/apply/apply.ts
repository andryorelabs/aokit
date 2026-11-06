import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { registerShutdownHook } from "../cli/shutdown.ts";
import type { Plan, PlanChange } from "../engine/plan.ts";
import type { FileContent } from "../engine/vfs.ts";
import { serializeLockfile } from "../lockfile/serialize.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { parseLockfile } from "../lockfile/read.ts";
import type { Git } from "../git/git.ts";
import { conflictFile, writeConflicts, type ConflictWrite } from "./conflicts.ts";
import { ApplyError } from "./errors.ts";
import { inSequence } from "./sequence.ts";
import { createStash, discardStash, restoreStash, type StashHandle } from "./stash.ts";

/** The Lockfile's path, relative to the Project root. */
export const lockfileName = "aokit.lock.json";

type CleanupHook = () => Promise<void>;

/** Options for {@link apply}. */
interface ApplyOptions {
  /** Registers interruption cleanup; defaults to the command layer's shutdown hook registry. */
  readonly registerCleanup?: (hook: CleanupHook) => () => void;
  /** Runs once everything is staged, right before the first write into the Project. */
  readonly beforeCommit?: (stagingDirectory: string) => void | Promise<void>;
  /** The git adapter of the Project; selects the stash location and records Conflict stages. */
  readonly git?: Git | undefined;
  /** Conflicts to write after the Plan; their paths keep the hash of the previous Lockfile. */
  readonly conflicts?: readonly ConflictWrite[];
  /** Keeps the stash of an existing Project after a successful apply and returns it. */
  readonly keepStash?: boolean;
}

/** What {@link apply} did. */
interface ApplyResult {
  readonly project: "new" | "existing";
  readonly directory: string;
  /** Present only when `keepStash` was set and the Project already existed. */
  readonly stash?: StashHandle;
}

interface StagedFile {
  readonly path: string;
  readonly content: FileContent;
  readonly mode: string | undefined;
  /** Project-relative file whose mode is kept when `mode` is not given. */
  readonly keepModeOf?: string;
}

interface Interruption {
  interrupted: boolean;
}

async function pathKind(path: string): Promise<"missing" | "directory" | "other"> {
  try {
    const stats = await stat(path);
    return stats.isDirectory() ? "directory" : "other";
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return "missing";
    }
    throw error;
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function throwIfInterrupted(interruption: Interruption): void {
  if (interruption.interrupted) {
    throw new ApplyError(
      "INTERRUPTED",
      "Apply was interrupted before the Project was changed.",
      "Run the command again to apply the Plan.",
    );
  }
}

async function existingMode(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mode & 0o7777;
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function stageFile(
  stagingDirectory: string,
  file: StagedFile,
  fallbackModeSource: string | undefined,
): Promise<void> {
  const destination = join(stagingDirectory, file.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, file.content);
  const mode =
    file.mode === undefined
      ? fallbackModeSource === undefined
        ? undefined
        : await existingMode(fallbackModeSource)
      : Number.parseInt(file.mode, 8);
  if (mode !== undefined) {
    await chmod(destination, mode);
  }
}

async function stageFiles(
  stagingDirectory: string,
  files: readonly StagedFile[],
  interruption: Interruption,
  projectDirectory: string | undefined,
): Promise<void> {
  await inSequence(files, async (file) => {
    throwIfInterrupted(interruption);
    const modeSource =
      projectDirectory === undefined || file.keepModeOf === undefined
        ? undefined
        : join(projectDirectory, file.keepModeOf);
    await stageFile(stagingDirectory, file, modeSource);
  });
}

function lockfileFile(lockfile: Lockfile): StagedFile {
  return { path: lockfileName, content: serializeLockfile(lockfile), mode: undefined };
}

function newProjectFiles(plan: Plan): StagedFile[] {
  const files: StagedFile[] = [];
  for (const path of plan.vfs.paths()) {
    const file = plan.vfs.get(path);
    if (file !== undefined && path !== lockfileName) {
      files.push({ path, content: file.content, mode: file.mode });
    }
  }
  return files;
}

function writtenChanges(plan: Plan): PlanChange[] {
  return plan.changes.filter((change) => change.type !== "delete" && change.content !== undefined);
}

function removedPaths(plan: Plan): string[] {
  return plan.changes.flatMap((change) => {
    if (change.type === "delete") {
      return [change.path];
    }
    return change.type === "rename" && change.renamedFrom !== undefined ? [change.renamedFrom] : [];
  });
}

async function pruneEmptyParents(projectDirectory: string, path: string): Promise<void> {
  const parent = dirname(path);
  if (parent === "." || parent === "") {
    return;
  }
  try {
    await rmdir(join(projectDirectory, parent));
  } catch (error) {
    if (isErrnoCode(error, "ENOTEMPTY") || isErrnoCode(error, "EEXIST")) {
      return;
    }
    throw error;
  }
  await pruneEmptyParents(projectDirectory, parent);
}

async function removeProjectFile(projectDirectory: string, path: string): Promise<void> {
  try {
    await unlink(join(projectDirectory, path));
  } catch (error) {
    if (!isErrnoCode(error, "ENOENT")) {
      throw error;
    }
  }
  await pruneEmptyParents(projectDirectory, path);
}

async function commitExisting(
  stagingDirectory: string,
  projectDirectory: string,
  written: readonly string[],
  removed: readonly string[],
  options: ApplyOptions,
): Promise<void> {
  await inSequence(written, async (path) => {
    const destination = join(projectDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await rename(join(stagingDirectory, path), destination);
  });
  await inSequence(removed, (path) => removeProjectFile(projectDirectory, path));
  await writeConflicts(projectDirectory, options.conflicts ?? [], options.git);
  await rename(join(stagingDirectory, lockfileName), join(projectDirectory, lockfileName));
}

async function pathExists(path: string): Promise<boolean> {
  return (await existingMode(path)) !== undefined;
}

async function lockfileKeepingConflictHashes(
  lockfile: Lockfile,
  projectDirectory: string,
  conflicts: readonly ConflictWrite[],
): Promise<Lockfile> {
  if (conflicts.length === 0) {
    return lockfile;
  }
  const previous = parseLockfile(await readFile(join(projectDirectory, lockfileName), "utf8"));
  const files = { ...lockfile.files };
  for (const { path } of conflicts) {
    const kept = previous.lockfile.files[path];
    if (kept !== undefined && files[path] !== undefined) {
      files[path] = { ...files[path], hash: kept.hash };
    }
  }
  return { ...lockfile, files };
}

async function commitWithRollback(
  stagingDirectory: string,
  projectDirectory: string,
  touched: readonly string[],
  written: readonly string[],
  removed: readonly string[],
  options: ApplyOptions,
): Promise<StashHandle | undefined> {
  const created = (
    await Promise.all(
      touched.map(async (path) => ((await pathExists(join(projectDirectory, path))) ? null : path)),
    )
  ).filter((path): path is string => path !== null);
  const stash = await createStash(projectDirectory, options.git, touched);
  try {
    await commitExisting(stagingDirectory, projectDirectory, written, removed, options);
  } catch (error) {
    try {
      await inSequence(options.conflicts ?? [], async (conflict) => {
        await options.git?.clearConflictStages(conflict.path);
      });
      await restoreStash(projectDirectory, stash, created);
    } catch (restoreError) {
      throw new ApplyError(
        "IO_ERROR",
        `Apply failed and the originals could not be restored automatically: ${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
        `Copy the files in "${stash.directory}" back into the Project, then run "aokit doctor".`,
        { cause: error },
      );
    }
    await discardStash(projectDirectory, options.git, stash);
    throw error;
  }
  if (options.keepStash === true) {
    return { ...stash, created };
  }
  await discardStash(projectDirectory, options.git, stash);
  return undefined;
}

async function applyNew(
  plan: Plan,
  lockfile: Lockfile,
  stagingDirectory: string,
  projectDirectory: string,
  interruption: Interruption,
  options: ApplyOptions,
): Promise<StashHandle | undefined> {
  await stageFiles(stagingDirectory, newProjectFiles(plan), interruption, undefined);
  await stageFiles(stagingDirectory, [lockfileFile(lockfile)], interruption, undefined);
  await options.beforeCommit?.(stagingDirectory);
  throwIfInterrupted(interruption);
  await rename(stagingDirectory, projectDirectory);
  return undefined;
}

async function applyExisting(
  plan: Plan,
  lockfile: Lockfile,
  stagingDirectory: string,
  projectDirectory: string,
  interruption: Interruption,
  options: ApplyOptions,
): Promise<StashHandle | undefined> {
  const files = writtenChanges(plan)
    .filter((change) => change.path !== lockfileName)
    .map((change) => ({
      path: change.path,
      content: change.content ?? "",
      mode: change.mode,
      keepModeOf: change.renamedFrom ?? change.path,
    }));
  await stageFiles(stagingDirectory, files, interruption, projectDirectory);
  const conflicts = options.conflicts ?? [];
  const effectiveLockfile = await lockfileKeepingConflictHashes(
    lockfile,
    projectDirectory,
    conflicts,
  );
  await stageFiles(
    stagingDirectory,
    [lockfileFile(effectiveLockfile)],
    interruption,
    projectDirectory,
  );
  await options.beforeCommit?.(stagingDirectory);
  throwIfInterrupted(interruption);
  const removed = removedPaths(plan).filter((path) => path !== lockfileName);
  const written = files.map((file) => file.path);
  const touched = [
    ...new Set([...written, ...removed, ...conflicts.map(conflictFile), lockfileName]),
  ];
  return commitWithRollback(stagingDirectory, projectDirectory, touched, written, removed, options);
}

function toApplyError(error: unknown, directory: string): ApplyError {
  if (error instanceof ApplyError) {
    return error;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new ApplyError(
    "IO_ERROR",
    `Could not apply the Plan to "${directory}": ${reason}`,
    "Check that the directory and its parent are writable, then run the command again.",
    { cause: error },
  );
}

async function assertParentExists(directory: string): Promise<void> {
  const parent = dirname(directory);
  if ((await pathKind(parent)) !== "directory") {
    throw new ApplyError(
      "IO_ERROR",
      `The parent directory "${parent}" does not exist.`,
      `Create "${parent}" first, then run the command again.`,
    );
  }
}

async function resolveProjectKind(directory: string): Promise<"new" | "existing"> {
  const kind = await pathKind(directory);
  if (kind === "other") {
    throw new ApplyError(
      "IO_ERROR",
      `"${directory}" exists and is not a directory.`,
      "Choose another Project directory, or remove the file first.",
    );
  }
  return kind === "missing" ? "new" : "existing";
}

/**
 * Writes a Plan and its Lockfile to `directory`. A new Project is staged in a uniquely named
 * sibling temp directory and renamed into place; an existing Project gets each file renamed from
 * the temp directory, the Lockfile last. On SIGINT or any error before the final rename the temp
 * directory is removed and the Project is unchanged.
 */
export async function apply(
  plan: Plan,
  lockfile: Lockfile,
  directory: string,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const projectDirectory = resolve(directory);
  const interruption: Interruption = { interrupted: false };
  const { promise: settled, resolve: markSettled } = Promise.withResolvers<void>();
  const unregister = (options.registerCleanup ?? registerShutdownHook)(async () => {
    interruption.interrupted = true;
    await settled;
  });
  let stagingDirectory: string | undefined;
  try {
    await assertParentExists(projectDirectory);
    const project = await resolveProjectKind(projectDirectory);
    throwIfInterrupted(interruption);
    const createdDirectory = join(
      dirname(projectDirectory),
      `.${basename(projectDirectory)}.aokit-tmp-${randomBytes(6).toString("hex")}`,
    );
    await mkdir(createdDirectory, { mode: 0o777 });
    stagingDirectory = createdDirectory;
    const applyByKind = project === "new" ? applyNew : applyExisting;
    const stash = await applyByKind(
      plan,
      lockfile,
      createdDirectory,
      projectDirectory,
      interruption,
      options,
    );
    return stash === undefined
      ? { project, directory: projectDirectory }
      : { project, directory: projectDirectory, stash };
  } catch (error) {
    throw toApplyError(error, projectDirectory);
  } finally {
    if (stagingDirectory !== undefined) {
      await rm(stagingDirectory, { recursive: true, force: true });
    }
    unregister();
    markSettled();
  }
}
