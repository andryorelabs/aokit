import type { ConflictWrite } from "../apply/index.ts";
import { type FileContent, Vfs } from "../engine/vfs.ts";
import { hashVfs, type Plan, type PlanChange, type Provenance } from "../engine/plan.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { isRegionFile } from "../patchers/markdown/regions.ts";
import type { Merger } from "../merger/index.ts";
import type { BuiltProject } from "../pipeline/build.ts";
import { normalizeUserContent, sameContent, textOf } from "./content.ts";

/** How a file in the user's tree relates to the Render recorded in the Lockfile. */
type DriftState = "pristine" | "modified" | "deleted" | "unknown" | "volatile";

/** One Lockfile file entry. */
type LockfileFileEntry = Lockfile["files"][string];

/** What {@link DriftOf} classifies; `user` is LF-normalized and absent when the file is missing. */
interface DriftQuery {
  readonly path: string;
  readonly entry: LockfileFileEntry | undefined;
  readonly user: FileContent | undefined;
}

/** Classifies a user-side file; injected so the merge procedure stays free of Lockfile hashing. */
export type DriftOf = (query: DriftQuery) => DriftState;

/** Inputs of {@link mergeProject}. */
export interface MergeProjectInput {
  /** The Render at the Lockfile's state; empty when there is none (recopy). */
  readonly base: Vfs;
  /** The Render the Project moves to. */
  readonly next: BuiltProject;
  /** Reads a Project-relative file from the user's tree; the only I/O of the merge. */
  readonly readUser: (path: string) => Promise<FileContent | undefined>;
  /** The Lockfile on disk. */
  readonly lockfile: Lockfile;
  readonly merger: Merger;
  readonly driftOf: DriftOf;
  /** Old path to new path, Project-relative and already Target-resolved. */
  readonly renames?: ReadonlyMap<string, string>;
  /**
   * Old seed path to new path. A seed moves with its current content and is never merged; an
   * existing file at the new path is a Conflict. Only `layout migrate` passes it.
   */
  readonly seedMoves?: ReadonlyMap<string, string>;
}

/** Result of {@link mergeProject}. */
export interface MergeProjectResult {
  /** What the user's tree holds after applying, for the paths the merge looked at. */
  readonly vfs: Vfs;
  readonly plan: Plan;
  readonly conflicts: ConflictWrite[];
  readonly warnings: string[];
  /** The Lockfile to write; conflicted paths carry the hash of the previous Lockfile. */
  readonly lockfile: Lockfile;
}

type EntryChoice = "next" | "previous" | "drop";

type Decision =
  | { readonly action: "keep"; readonly entry: EntryChoice; readonly warning?: string }
  | { readonly action: "write"; readonly content: FileContent }
  | { readonly action: "delete" }
  | { readonly action: "conflict"; readonly write: ConflictWrite };

interface PathContext {
  readonly input: MergeProjectInput;
  readonly path: string;
  /** Where the user's file, the Lockfile entry and the base Render live; differs from `path` on a rename. */
  readonly sourcePath: string;
  readonly entry: LockfileFileEntry | undefined;
  readonly user: FileContent | undefined;
  readonly drift: DriftState;
}

interface Accumulator {
  readonly vfs: Vfs;
  readonly changes: PlanChange[];
  readonly conflicts: ConflictWrite[];
  readonly warnings: string[];
  readonly files: Lockfile["files"];
}

const bunLockfile = "bun.lock";
const neverMerged = new Set([bunLockfile, "aokit.lock.json"]);

function pathUniverse(
  input: MergeProjectInput,
  renamedFrom: ReadonlyMap<string, string>,
  seedMoved: ReadonlyMap<string, string>,
): string[] {
  const sources = new Set([...renamedFrom.values(), ...seedMoved.values()]);
  for (const destination of seedMoved.keys()) sources.add(destination);
  const paths = new Set([
    ...Object.keys(input.lockfile.files),
    ...input.base.paths(),
    ...input.next.plan.vfs.paths(),
  ]);
  for (const source of sources) paths.delete(source);
  return [...paths].filter((path) => !neverMerged.has(path)).toSorted();
}

async function mergeContents(
  { input, path, sourcePath }: PathContext,
  user: FileContent,
  next: FileContent,
): Promise<Decision> {
  const base = input.base.read(sourcePath) ?? "";
  const outcome = await input.merger.merge({ base, user, next, path });
  if (outcome.conflict) {
    const merged =
      outcome.aokitNew === undefined && typeof outcome.content === "string"
        ? outcome.content
        : undefined;
    return {
      action: "conflict",
      write: {
        path,
        ...(merged === undefined ? {} : { merged }),
        next: outcome.aokitNew ?? next,
        base: textOf(base),
        user: textOf(user),
      },
    };
  }
  const content = outcome.content ?? user;
  return sameContent(content, user)
    ? { action: "keep", entry: "next" }
    : { action: "write", content };
}

function decideRemoved({ path, entry, user, drift }: PathContext): Decision {
  if (entry === undefined || user === undefined) return { action: "keep", entry: "drop" };
  const solelyOwned = entry.mode !== "seed" || entry.owners.length === 1;
  if (drift === "pristine" && solelyOwned) return { action: "delete" };
  const reason = drift === "pristine" ? "is shared with other Modules" : "was modified";
  return {
    action: "keep",
    entry: "drop",
    warning: `${path} is no longer generated and was kept because it ${reason}; it is no longer tracked for ${entry.owners.join(", ")}.`,
  };
}

async function decideManaged(context: PathContext, next: FileContent): Promise<Decision> {
  const { input, path, entry, user, drift } = context;
  if (entry === undefined) {
    if (user === undefined) return { action: "write", content: next };
    if (sameContent(user, next)) return { action: "keep", entry: "next" };
    if (isRegionFile(path)) return mergeContents(context, user, next);
    return {
      action: "conflict",
      write: { path, next, base: "", user: textOf(user) },
    };
  }
  if (user === undefined) {
    const base = input.base.read(context.sourcePath);
    const changed = base !== undefined && !sameContent(base, next);
    return {
      action: "keep",
      entry: "next",
      ...(changed
        ? { warning: `${path} was deleted and stays deleted although its Render changed.` }
        : {}),
    };
  }
  if (drift === "pristine" && !isRegionFile(path)) {
    return sameContent(user, next)
      ? { action: "keep", entry: "next" }
      : { action: "write", content: next };
  }
  return mergeContents(context, user, next);
}

function decideSeed({ path, entry, user }: PathContext, next: FileContent): Decision {
  if (entry !== undefined) return { action: "keep", entry: "previous" };
  if (user === undefined) return { action: "write", content: next };
  return {
    action: "keep",
    entry: "next",
    warning: `${path} already exists and was kept instead of being replaced by the new seed.`,
  };
}

function decide(context: PathContext): Promise<Decision> | Decision {
  const { input, path, entry, user, drift } = context;
  if (entry?.mode === "ejected") return { action: "keep", entry: "previous" };
  const nextFile = input.next.plan.vfs.get(path);
  if (nextFile === undefined) return decideRemoved(context);
  if (nextFile.volatile || drift === "volatile") {
    return user === undefined
      ? { action: "write", content: nextFile.content }
      : { action: "keep", entry: "next" };
  }
  if (nextFile.ownership === "seed" || entry?.mode === "seed") {
    return decideSeed(context, nextFile.content);
  }
  return decideManaged(context, nextFile.content);
}

function provenanceLookup(input: MergeProjectInput): (path: string) => readonly Provenance[] {
  const planned = new Map(
    input.next.plan.changes.map((change) => [change.path, change.provenance]),
  );
  return (path) =>
    planned.get(path) ??
    (input.next.lockfile.files[path]?.owners ?? []).map((module) => ({
      module,
      entry: { kind: "file" as const, from: path },
    }));
}

function recordWrite(
  context: PathContext,
  content: FileContent,
  state: Accumulator,
  provenanceOf: (path: string) => readonly Provenance[],
): void {
  const { input, path, user } = context;
  const renamed = isRename(context) && user !== undefined;
  const nextFile = input.next.plan.vfs.get(path);
  const ownership = nextFile?.ownership ?? "managed";
  state.vfs.write(path, content, {
    ownership,
    volatile: nextFile?.volatile ?? false,
    ...(nextFile?.mode === undefined ? {} : { mode: nextFile.mode }),
  });
  state.changes.push({
    type: renamed ? "rename" : user === undefined ? "create" : "update",
    path,
    ...(renamed ? { renamedFrom: context.sourcePath } : {}),
    content,
    ...(user === undefined ? {} : { previousContent: user }),
    ownership,
    mode: nextFile?.mode,
    provenance: provenanceOf(path),
  });
  keepEntry(context, "next", state);
}

function isRename({ path, sourcePath }: PathContext): boolean {
  return path !== sourcePath;
}

function recordKeptRename(context: PathContext, user: FileContent, state: Accumulator): void {
  const { input, path } = context;
  const nextFile = input.next.plan.vfs.get(path);
  state.vfs.write(path, user, {
    ownership: nextFile?.ownership ?? "managed",
    volatile: nextFile?.volatile ?? false,
    ...(nextFile?.mode === undefined ? {} : { mode: nextFile.mode }),
  });
  state.changes.push({
    type: "rename",
    path,
    renamedFrom: context.sourcePath,
    content: user,
    previousContent: user,
    ownership: nextFile?.ownership ?? "managed",
    mode: nextFile?.mode,
    provenance: provenanceLookup(input)(path),
  });
}

function recordDelete({ path, entry, user }: PathContext, state: Accumulator): void {
  state.changes.push({
    type: "delete",
    path,
    previousContent: user ?? "",
    ownership: entry?.mode ?? "managed",
    mode: undefined,
    provenance: (entry?.owners ?? []).map((module) => ({ module, entry: { kind: "remove" } })),
  });
}

function keepEntry(
  { input, path, sourcePath }: PathContext,
  choice: EntryChoice,
  state: Accumulator,
): void {
  const chosen =
    choice === "previous"
      ? input.lockfile.files[sourcePath]
      : choice === "next"
        ? input.next.lockfile.files[path]
        : undefined;
  if (chosen !== undefined) state.files[path] = chosen;
}

function writeKeptUser(context: PathContext, content: FileContent, state: Accumulator): void {
  const mode = context.input.next.plan.vfs.get(context.path)?.mode;
  state.vfs.write(context.path, content, mode === undefined ? {} : { mode });
}

function recordConflict(context: PathContext, write: ConflictWrite, state: Accumulator): void {
  const { input, path, user } = context;
  state.conflicts.push(write);
  writeKeptUser(context, write.merged ?? user ?? write.next, state);
  const next = input.next.lockfile.files[path];
  const previous = input.lockfile.files[context.sourcePath];
  if (isRename(context) && user !== undefined && write.merged === undefined) {
    recordKeptRename(context, user, state);
  } else if (isRename(context) && user !== undefined) {
    state.changes.push({
      type: "delete",
      path: context.sourcePath,
      previousContent: user,
      ownership: previous?.mode ?? "managed",
      mode: undefined,
      provenance: (previous?.owners ?? []).map((module) => ({ module, entry: { kind: "remove" } })),
    });
  }
  if (previous === undefined) return;
  state.files[path] = next === undefined ? previous : { ...next, hash: previous.hash };
}

function recordDecision(
  context: PathContext,
  decision: Decision,
  state: Accumulator,
  provenanceOf: (path: string) => readonly Provenance[],
): void {
  if (decision.action === "write") {
    recordWrite(context, decision.content, state, provenanceOf);
  } else if (decision.action === "delete") {
    recordDelete(context, state);
  } else if (decision.action === "conflict") {
    recordConflict(context, decision.write, state);
  } else {
    if (context.user !== undefined && isRename(context)) {
      recordKeptRename(context, context.user, state);
    } else if (context.user !== undefined) {
      writeKeptUser(context, context.user, state);
    }
    keepEntry(context, decision.entry, state);
    if (decision.warning !== undefined) state.warnings.push(decision.warning);
  }
}

async function isApplicableRename(
  input: MergeProjectInput,
  from: string,
  to: string,
): Promise<boolean> {
  const entry = input.lockfile.files[from];
  const nextFile = input.next.plan.vfs.get(to);
  if (from === to || entry === undefined || entry.mode !== "managed") return false;
  if (nextFile === undefined || nextFile.ownership !== "managed" || nextFile.volatile) return false;
  if (input.next.plan.vfs.has(from) || input.lockfile.files[to] !== undefined) return false;
  return (await input.readUser(to)) === undefined;
}

/**
 * The renames that can move a file: the old path is a managed Lockfile entry the next Render no
 * longer produces, and the new path is free in the Lockfile and on disk. Any other rename stays
 * delete plus create, so an `unknown` file at the new path raises a Conflict. Keyed by new path.
 */
async function effectiveRenames(input: MergeProjectInput): Promise<Map<string, string>> {
  const candidates = [...(input.renames ?? [])].filter(
    ([from, to]) => !neverMerged.has(from) && !neverMerged.has(to),
  );
  const verdicts = await Promise.all(
    candidates.map(([from, to]) => isApplicableRename(input, from, to)),
  );
  const applicable = new Map<string, string>();
  const sources = new Set<string>();
  candidates.forEach(([from, to], index) => {
    if (!verdicts[index] || applicable.has(to) || sources.has(from)) return;
    sources.add(from);
    applicable.set(to, from);
  });
  return applicable;
}

function isApplicableSeedMove(input: MergeProjectInput, from: string, to: string): boolean {
  const entry = input.lockfile.files[from];
  const nextFile = input.next.plan.vfs.get(to);
  if (from === to || entry?.mode !== "seed") return false;
  if (nextFile === undefined || nextFile.ownership !== "seed") return false;
  return !input.next.plan.vfs.has(from) && input.lockfile.files[to] === undefined;
}

/** The seed moves whose old path is a seed Lockfile entry the next Render dropped. Keyed by new path. */
async function effectiveSeedMoves(input: MergeProjectInput): Promise<Map<string, string>> {
  const candidates = [...(input.seedMoves ?? [])].filter(([from, to]) =>
    isApplicableSeedMove(input, from, to),
  );
  const present = await Promise.all(
    candidates.map(async ([from]) => (await input.readUser(from)) !== undefined),
  );
  const moves = new Map<string, string>();
  const sources = new Set<string>();
  candidates.forEach(([from, to], index) => {
    if (!present[index] || moves.has(to) || sources.has(from)) return;
    sources.add(from);
    moves.set(to, from);
  });
  return moves;
}

interface SeedMoveReads {
  readonly from: string;
  readonly to: string;
  readonly content: FileContent | undefined;
  readonly existing: FileContent | undefined;
}

async function readSeedMove(
  input: MergeProjectInput,
  from: string,
  to: string,
): Promise<SeedMoveReads> {
  return {
    from,
    to,
    content: normalizeUserContent(await input.readUser(from)),
    existing: normalizeUserContent(await input.readUser(to)),
  };
}

function recordSeedMove(
  input: MergeProjectInput,
  { from, to, content, existing }: SeedMoveReads,
  state: Accumulator,
  provenanceOf: (path: string) => readonly Provenance[],
): void {
  const previous = input.lockfile.files[from];
  const nextFile = input.next.plan.vfs.get(to);
  if (content === undefined) return;
  const mode = nextFile?.mode === undefined ? {} : { mode: nextFile.mode };
  if (existing !== undefined) {
    state.conflicts.push({ path: to, next: content, base: "", user: textOf(existing) });
    state.vfs.write(to, existing, mode);
  } else {
    state.vfs.write(to, content, { ownership: "seed", ...mode });
    state.changes.push({
      type: "rename",
      path: to,
      renamedFrom: from,
      content,
      previousContent: content,
      ownership: "seed",
      mode: nextFile?.mode,
      provenance: provenanceOf(to),
    });
  }
  if (previous !== undefined) state.files[to] = previous;
}

/**
 * The VFS-to-VFS merge procedure shared by add, remove and recopy. It reads the user side only for
 * paths in the Lockfile or in either Render, never formats user content, and never pairs renames
 * by identical content. `bun.lock` is never merged.
 */
export async function mergeProject(input: MergeProjectInput): Promise<MergeProjectResult> {
  const state: Accumulator = {
    vfs: Vfs.empty(),
    changes: [],
    conflicts: [],
    warnings: [],
    files: {},
  };
  const provenanceOf = provenanceLookup(input);
  const renamedFrom = await effectiveRenames(input);
  const seedMoved = await effectiveSeedMoves(input);
  const decided = await Promise.all(
    pathUniverse(input, renamedFrom, seedMoved).map(async (path) => {
      const sourcePath = renamedFrom.get(path) ?? path;
      const user = normalizeUserContent(await input.readUser(sourcePath));
      const entry = input.lockfile.files[sourcePath];
      const drift = input.driftOf({ path: sourcePath, entry, user });
      const context: PathContext = { input, path, sourcePath, entry, user, drift };
      return { context, decision: await decide(context) };
    }),
  );
  for (const { context, decision } of decided) {
    recordDecision(context, decision, state, provenanceOf);
  }
  const seedReads = await Promise.all(
    [...seedMoved].map(([to, from]) => readSeedMove(input, from, to)),
  );
  for (const reads of seedReads) recordSeedMove(input, reads, state, provenanceOf);
  const bunEntry = input.lockfile.files[bunLockfile] ?? input.next.lockfile.files[bunLockfile];
  if (bunEntry !== undefined) state.files[bunLockfile] = bunEntry;
  const plan: Plan = {
    changes: state.changes.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    hash: hashVfs(state.vfs),
    vfs: state.vfs,
  };
  return {
    vfs: state.vfs,
    plan,
    conflicts: state.conflicts,
    warnings: state.warnings,
    lockfile: { ...input.next.lockfile, files: state.files },
  };
}
