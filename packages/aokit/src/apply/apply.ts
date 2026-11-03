import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { registerShutdownHook } from "../cli/shutdown.ts";
import type { Plan, PlanChange } from "../engine/plan.ts";
import type { FileContent } from "../engine/vfs.ts";
import { serializeLockfile } from "../lockfile/serialize.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { ApplyError } from "./errors.ts";

/** The Lockfile's path, relative to the Project root. */
export const lockfileName = "aokit.lock.json";

type CleanupHook = () => Promise<void>;

/** Options for {@link apply}. */
interface ApplyOptions {
  /** Registers interruption cleanup; defaults to the command layer's shutdown hook registry. */
  readonly registerCleanup?: (hook: CleanupHook) => () => void;
  /** Runs once everything is staged, right before the first write into the Project. */
  readonly beforeCommit?: (stagingDirectory: string) => void | Promise<void>;
}

/** What {@link apply} did. */
interface ApplyResult {
  readonly project: "new" | "existing";
  readonly directory: string;
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

/** Runs `action` for each item, one at a time, in order. */
async function inSequence<Item>(
  items: readonly Item[],
  action: (item: Item) => Promise<void>,
): Promise<void> {
  await items.reduce<Promise<void>>(
    (previous, item) => previous.then(() => action(item)),
    Promise.resolve(),
  );
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
): Promise<void> {
  await inSequence(written, async (path) => {
    const destination = join(projectDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await rename(join(stagingDirectory, path), destination);
  });
  await inSequence(removed, (path) => removeProjectFile(projectDirectory, path));
  await rename(join(stagingDirectory, lockfileName), join(projectDirectory, lockfileName));
}

async function applyNew(
  plan: Plan,
  lockfile: Lockfile,
  stagingDirectory: string,
  projectDirectory: string,
  interruption: Interruption,
  options: ApplyOptions,
): Promise<void> {
  await stageFiles(stagingDirectory, newProjectFiles(plan), interruption, undefined);
  await stageFiles(stagingDirectory, [lockfileFile(lockfile)], interruption, undefined);
  await options.beforeCommit?.(stagingDirectory);
  throwIfInterrupted(interruption);
  await rename(stagingDirectory, projectDirectory);
}

async function applyExisting(
  plan: Plan,
  lockfile: Lockfile,
  stagingDirectory: string,
  projectDirectory: string,
  interruption: Interruption,
  options: ApplyOptions,
): Promise<void> {
  const files = writtenChanges(plan)
    .filter((change) => change.path !== lockfileName)
    .map((change) => ({
      path: change.path,
      content: change.content ?? "",
      mode: change.mode,
      keepModeOf: change.renamedFrom ?? change.path,
    }));
  await stageFiles(stagingDirectory, files, interruption, projectDirectory);
  await stageFiles(stagingDirectory, [lockfileFile(lockfile)], interruption, projectDirectory);
  await options.beforeCommit?.(stagingDirectory);
  throwIfInterrupted(interruption);
  const removed = removedPaths(plan).filter((path) => path !== lockfileName);
  await commitExisting(
    stagingDirectory,
    projectDirectory,
    files.map((file) => file.path),
    removed,
  );
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
    stagingDirectory = await mkdtemp(
      join(dirname(projectDirectory), `.${basename(projectDirectory)}.aokit-tmp-`),
    );
    const applyByKind = project === "new" ? applyNew : applyExisting;
    await applyByKind(plan, lockfile, stagingDirectory, projectDirectory, interruption, options);
    return { project, directory: projectDirectory };
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
