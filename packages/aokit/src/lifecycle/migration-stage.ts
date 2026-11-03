import type { ConflictWrite } from "../apply/index.ts";
import { conflictFile } from "../apply/conflicts.ts";
import { hashVfs, type Plan, type PlanChange } from "../engine/plan.ts";
import { compareByCodepoint, type FileContent, Vfs } from "../engine/vfs.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import type { UserEdits, MergeProjectResult } from "./run.ts";

const aokitOwned = new Set(["aokit.lock.json", "bun.lock"]);

function sameContent(left: FileContent | undefined, right: FileContent | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return Buffer.from(left).equals(Buffer.from(right));
}

/** The user's tree as Migrations see it: every file, minus aokit's own state. */
export async function loadUserTree(directory: string): Promise<Vfs> {
  const tree = await Vfs.fromDirectory(directory);
  for (const path of tree.paths()) {
    if (aokitOwned.has(path) || path.startsWith(".aokit/") || path.endsWith(".aokit-new")) {
      tree.delete(path);
    }
  }
  return tree;
}

/** Every path whose content differs between two trees; `undefined` marks a deletion. */
function editsBetween(before: Vfs, after: Vfs): Map<string, FileContent | undefined> {
  const edits = new Map<string, FileContent | undefined>();
  for (const path of new Set([...before.paths(), ...after.paths()])) {
    const next = after.read(path);
    if (!sameContent(before.read(path), next)) edits.set(path, next);
  }
  return edits;
}

/**
 * The edits of the `before` Migrations the merge may read. A file the user deleted and the Lockfile
 * tracks stays deleted, so a Migration cannot bring it back.
 */
export function mergeVisibleEdits(original: Vfs, edited: Vfs, lockfile: Lockfile): UserEdits {
  const edits = editsBetween(original, edited);
  for (const [path, content] of edits) {
    if (content !== undefined && !original.has(path) && lockfile.files[path] !== undefined) {
      edits.delete(path);
    }
  }
  return edits;
}

interface AfterStageInput {
  readonly merged: MergeProjectResult;
  readonly lockfile: Lockfile;
  /** The user's tree as read from disk, before any Migration. */
  readonly original: Vfs;
  /** The user's tree after the `before` Migrations. */
  readonly edited: Vfs;
  /** Runs the `after` Migrations over the VFS it receives. */
  readonly run: (vfs: Vfs) => Promise<void>;
}

function lockedButAbsent(path: string, input: AfterStageInput, snapshot: Vfs): boolean {
  return input.lockfile.files[path] !== undefined && !snapshot.has(path);
}

function conflictedPaths(conflicts: readonly ConflictWrite[]): Set<string> {
  return new Set(conflicts.flatMap((conflict) => [conflict.path, conflictFile(conflict)]));
}

function changeFor(
  path: string,
  content: FileContent | undefined,
  previous: FileContent | undefined,
  existing: PlanChange | undefined,
): PlanChange | undefined {
  if (content === undefined && previous === undefined) return undefined;
  const type = content === undefined ? "delete" : previous === undefined ? "create" : "update";
  return {
    type,
    path,
    ...(content === undefined ? {} : { content }),
    ...(previous === undefined ? {} : { previousContent: previous }),
    ownership: existing?.ownership ?? "managed",
    mode: existing?.mode,
    provenance: existing?.provenance ?? [],
  };
}

/**
 * Runs the `after` Migrations over the merged tree plus the user files the merge never looked at,
 * and folds what they changed back into the Plan. Files in a Conflict are left alone, and a file
 * the user deleted that the Lockfile tracks is not recreated. A file a `before` Migration deleted
 * becomes a delete in the Plan unless the new Render writes it again.
 */
export async function applyAfterStage(input: AfterStageInput): Promise<MergeProjectResult> {
  const { merged } = input;
  const working = merged.vfs.clone();
  const outside = new Set<string>();
  for (const path of input.edited.paths()) {
    if (!merged.vfs.has(path) && input.lockfile.files[path] === undefined) {
      working.write(path, input.edited.read(path) ?? "");
      outside.add(path);
    }
  }
  const snapshot = working.clone();
  await input.run(working);
  const skipped = conflictedPaths(merged.conflicts);
  const changes = new Map(merged.plan.changes.map((change) => [change.path, change]));
  const vfs = merged.vfs.clone();
  for (const [path, content] of editsBetween(snapshot, working)) {
    if (skipped.has(path) || lockedButAbsent(path, input, snapshot)) continue;
    const existing = changes.get(path);
    const previous = outside.has(path)
      ? input.original.read(path)
      : (existing?.previousContent ?? snapshot.read(path));
    const change = changeFor(path, content, previous, existing);
    if (change === undefined) continue;
    changes.set(path, existing?.renamedFrom === undefined ? change : { ...change, type: "rename" });
    if (content === undefined) vfs.delete(path);
    else vfs.write(path, content);
  }
  for (const path of input.original.paths()) {
    if (input.edited.has(path) || vfs.has(path) || skipped.has(path)) continue;
    const change = changeFor(path, undefined, input.original.read(path), changes.get(path));
    if (change !== undefined) changes.set(path, change);
  }
  for (const path of outside) {
    if (changes.has(path) || skipped.has(path)) continue;
    const content = working.read(path);
    const previous = input.original.read(path);
    if (sameContent(content, previous)) continue;
    const change = changeFor(path, content, previous, undefined);
    if (change === undefined) continue;
    changes.set(path, change);
    if (content !== undefined) vfs.write(path, content);
  }
  const plan: Plan = {
    changes: [...changes.values()].toSorted((left, right) =>
      compareByCodepoint(left.path, right.path),
    ),
    hash: hashVfs(vfs),
    vfs,
  };
  return { ...merged, plan, vfs };
}
