import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { apply, lockfileName, type ConflictWrite } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import { Vfs, type FileContent } from "../engine/vfs.ts";
import type { Plan } from "../engine/plan.ts";
import { assertCleanTree, openGit } from "../git/index.ts";
import { readLockfile } from "../lockfile/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { createMerger } from "../merger/index.ts";
import { mergeProject, type DriftOf } from "../merge/index.ts";
import type { BuiltProject } from "../pipeline/build.ts";
import { unifiedDiff } from "../project/diff.ts";
import { runInstall } from "../project/install.ts";

/** How a command produces the two Renders the merge works from. */
interface LifecycleRender {
  /** The Render at the Lockfile's state; `undefined` when the command has no base (recopy). */
  base(lockfile: Lockfile): Promise<BuiltProject | undefined>;
  /** The Render the Project moves to. */
  next(lockfile: Lockfile, base: BuiltProject | undefined): Promise<BuiltProject>;
}

/** Inputs of {@link runLifecycle}. */
export interface LifecycleInput {
  readonly dir: string;
  readonly render: LifecycleRender;
  readonly driftOf: DriftOf;
  readonly allowDirty: boolean;
  /** Builds and returns the Plan without writing anything. */
  readonly dryRun: boolean;
  /** Returns the unified diff of the Plan; nothing is written. */
  readonly diff: boolean;
  /** Runs `bun install` after a Plan that changed `package.json`. */
  readonly install: boolean;
  /** Replaces the default `bun install` runner. */
  readonly installer?: (directory: string) => Promise<void>;
}

/** What {@link runLifecycle} did. */
export interface LifecycleResult {
  readonly plan: Plan;
  readonly conflicts: ConflictWrite[];
  readonly warnings: string[];
  readonly lockfile: Lockfile;
  /** Unified diff of the Plan; set when `dryRun` or `diff` was requested. */
  readonly diff?: string;
  /** True when the Plan was written to disk. */
  readonly applied: boolean;
  /** True when `bun install` ran. */
  readonly installed: boolean;
}

async function readUserFile(dir: string, path: string): Promise<FileContent | undefined> {
  try {
    return new Uint8Array(await readFile(join(dir, path)));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "EISDIR"].includes(String(error.code))
    ) {
      return undefined;
    }
    throw error;
  }
}

async function readProjectLockfile(dir: string): Promise<Lockfile> {
  const parsed = await readLockfile(join(dir, lockfileName));
  if (parsed === null) {
    throw new AokitError(
      "LOCKFILE_MISSING",
      `No ${lockfileName} found in "${dir}".`,
      "Run the command inside an aokit Project, or create one with `aokit create`.",
    );
  }
  return parsed.lockfile;
}

function packageJsonChanged(plan: Plan): boolean {
  return plan.changes.some(
    (change) =>
      (change.path === "package.json" || change.path.endsWith("/package.json")) &&
      change.type !== "delete",
  );
}

/**
 * The orchestrator shared by add, remove and recopy: clean tree, base Render, next Render, merge,
 * transactional apply, conflict writer, install. Conflicts are returned, not thrown, so the command
 * decides the exit code (`MERGE_CONFLICTS`). With `dryRun` or `diff` nothing is written.
 */
export async function runLifecycle(input: LifecycleInput): Promise<LifecycleResult> {
  const lockfile = await readProjectLockfile(input.dir);
  const clean = await assertCleanTree(input.dir, { allowDirty: input.allowDirty, lockfile });
  const base = await input.render.base(lockfile);
  const next = await input.render.next(lockfile, base);
  const git = await openGit(input.dir);
  const merged = await mergeProject({
    base: base?.plan.vfs ?? Vfs.empty(),
    next,
    readUser: (path) => readUserFile(input.dir, path),
    lockfile,
    merger: createMerger(git === null ? {} : { git }),
    driftOf: input.driftOf,
  });
  const warnings = [...(clean.warning === undefined ? [] : [clean.warning]), ...merged.warnings];
  const result = {
    plan: merged.plan,
    conflicts: merged.conflicts,
    warnings,
    lockfile: merged.lockfile,
  };
  if (input.dryRun || input.diff) {
    return { ...result, diff: unifiedDiff(merged.plan), applied: false, installed: false };
  }
  await apply(merged.plan, merged.lockfile, input.dir, {
    ...(git === null ? {} : { git }),
    conflicts: merged.conflicts,
  });
  const shouldInstall = input.install && packageJsonChanged(merged.plan);
  if (shouldInstall) await (input.installer ?? ((dir) => runInstall(dir, process.env)))(input.dir);
  return { ...result, applied: true, installed: shouldInstall };
}
