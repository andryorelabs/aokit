import { createHash } from "node:crypto";
import { type FileContent, type Ownership, type Vfs, compareByCodepoint } from "./vfs.ts";

/** What in a Module caused a change. */
export type ProvenanceEntry =
  | { readonly kind: "file"; readonly from: string }
  | { readonly kind: "op"; readonly op: string }
  | { readonly kind: "remove" }
  | { readonly kind: "formatter" };

/** The Module (and file entry or Op) behind a change. */
export interface Provenance {
  readonly module: string;
  readonly entry: ProvenanceEntry;
  readonly overridden?: true;
}

/** One change in a Plan. */
export interface PlanChange {
  readonly type: "create" | "update" | "delete" | "rename";
  readonly path: string;
  readonly renamedFrom?: string;
  readonly content?: FileContent;
  readonly previousContent?: FileContent;
  readonly ownership: Ownership;
  readonly mode: string | undefined;
  readonly provenance: readonly Provenance[];
}

/** The VFS diff against disk, plus the final VFS and its deterministic hash. */
export interface Plan {
  readonly changes: readonly PlanChange[];
  readonly hash: string;
  readonly vfs: Vfs;
}

/** Formats the whole VFS after all Modules ran; skipped when a Project has none. */
export interface Formatter {
  readonly name: string;
  format(vfs: Vfs): Vfs | Promise<Vfs>;
}

function toBytes(content: FileContent): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

function contentEquals(left: FileContent, right: FileContent): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return left === right;
  }
  const leftBytes = toBytes(left);
  const rightBytes = toBytes(right);
  return (
    leftBytes.length === rightBytes.length && leftBytes.every((byte, i) => byte === rightBytes[i])
  );
}

function digest(content: FileContent): string {
  return createHash("sha256").update(toBytes(content)).digest("hex");
}

/**
 * sha256 over sorted paths and LF-normalized content. Files marked volatile contribute their path
 * only.
 */
export function hashVfs(vfs: Vfs): string {
  const hash = createHash("sha256");
  for (const path of vfs.paths()) {
    const file = vfs.get(path);
    if (file === undefined) {
      continue;
    }
    hash.update(`${path}\0`);
    if (file.volatile) {
      hash.update("volatile\0");
      continue;
    }
    const bytes = toBytes(file.content);
    hash.update(`${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

/** Provenance for a path, falling back to a single formatter-free default. */
export type ProvenanceLookup = (path: string) => readonly Provenance[];

/**
 * Diffs the next VFS against the one loaded from disk. A deleted and a created file with identical
 * content pair up as a `rename`.
 */
export function diffVfs(
  base: Vfs,
  next: Vfs,
  provenanceOf: ProvenanceLookup,
): readonly PlanChange[] {
  const changes: PlanChange[] = [];
  const created: string[] = [];
  const deleted: string[] = [];

  for (const path of next.paths()) {
    const file = next.get(path);
    const before = base.get(path);
    if (file === undefined) {
      continue;
    }
    if (before === undefined) {
      created.push(path);
    } else if (!contentEquals(before.content, file.content)) {
      changes.push({
        type: "update",
        path,
        content: file.content,
        previousContent: before.content,
        ownership: file.ownership,
        mode: file.mode,
        provenance: provenanceOf(path),
      });
    }
  }
  for (const path of base.paths()) {
    if (!next.has(path)) {
      deleted.push(path);
    }
  }

  const deletedByDigest = new Map<string, string[]>();
  for (const path of deleted) {
    const content = base.read(path);
    if (content !== undefined) {
      const key = digest(content);
      deletedByDigest.set(key, [...(deletedByDigest.get(key) ?? []), path]);
    }
  }
  const renamedSources = new Set<string>();
  for (const path of created) {
    const file = next.get(path);
    if (file === undefined) {
      continue;
    }
    const source = deletedByDigest.get(digest(file.content))?.shift();
    if (source !== undefined) {
      renamedSources.add(source);
    }
    changes.push({
      type: source === undefined ? "create" : "rename",
      path,
      ...(source === undefined ? {} : { renamedFrom: source }),
      content: file.content,
      ownership: file.ownership,
      mode: file.mode,
      provenance: provenanceOf(path),
    });
  }
  for (const path of deleted) {
    if (renamedSources.has(path)) {
      continue;
    }
    const before = base.get(path);
    changes.push({
      type: "delete",
      path,
      previousContent: before?.content ?? "",
      ownership: before?.ownership ?? "managed",
      mode: before?.mode,
      provenance: provenanceOf(path),
    });
  }
  return changes.toSorted((a, b) => compareByCodepoint(a.path, b.path));
}
