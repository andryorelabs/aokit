import type { EditBatch } from "../../edit/batch.ts";
import { CodeOpError } from "./errors.ts";
import { ledgerOf } from "./queued.ts";
import type { AnchorSite } from "./resolve.ts";

const keyPattern = /^(?:\[\s*)?(?:"([^"]*)"|'([^']*)'|([A-Za-z_$][\w$]*))\s*\]?\s*(?::|\(|,|$)/;

function squash(text: string): string {
  return text.replaceAll(/\s+/g, "");
}

function entryKey(entrySource: string): string | undefined {
  const match = keyPattern.exec(entrySource);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

/** The entry texts already queued in `batch` for the anchor of `site`. */
export function queuedEntries(batch: EditBatch, site: AnchorSite): string[] {
  const { entries } = ledgerOf(batch);
  let queued = entries.get(site.anchor.name);
  if (!queued) {
    queued = [];
    entries.set(site.anchor.name, queued);
  }
  return queued;
}

function entrySources(site: AnchorSite, queued: readonly string[]): string[] {
  const written = (site.anchor.value?.entries ?? []).map((entry) =>
    site.source.slice(entry.start, entry.end),
  );
  return [...written, ...queued];
}

/** True when the anchor already has, or has queued, an entry whose text equals `text` ignoring whitespace. */
export function hasEntryText(
  site: AnchorSite,
  text: string,
  queued: readonly string[] = [],
): boolean {
  const wanted = squash(text);
  return entrySources(site, queued).some((existing) => squash(existing) === wanted);
}

/** The text of the anchor object's property named `key`, written or queued, if it has one. */
export function findEntryByKey(
  site: AnchorSite,
  key: string,
  queued: readonly string[] = [],
): string | undefined {
  const wanted = key.replace(/^(["'])(.*)\1$/, "$2");
  return entrySources(site, queued).find((existing) => entryKey(existing) === wanted);
}

/** True when two entries have the same text ignoring whitespace. */
export function sameEntry(left: string, right: string): boolean {
  return squash(left) === squash(right);
}

function requireValue(site: AnchorSite, kind: "array" | "object", module: string) {
  const value = site.anchor.value;
  if (value?.kind !== kind) {
    throw new CodeOpError(
      "ops.extension-point-kind",
      `Anchor "${site.anchor.name}" in ${site.path} must be initialised with ${kind === "array" ? "an array" : "an object"} literal.`,
      module,
    );
  }
  return value;
}

function lineIndent(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart, offset))?.[0] ?? "";
}

/**
 * Appends `text` as the last entry of the anchor's array or object literal. Entries already
 * queued at the same position keep their order and are separated from `text`.
 */
export function appendEntry(
  batch: EditBatch,
  site: AnchorSite,
  module: string,
  kind: "array" | "object",
  text: string,
): void {
  const queued = queuedEntries(batch, site);
  appendEntryEdits(batch, site, module, kind, text, queued.length > 0);
  queued.push(text);
}

function appendEntryEdits(
  batch: EditBatch,
  site: AnchorSite,
  module: string,
  kind: "array" | "object",
  text: string,
  afterQueued: boolean,
): void {
  const value = requireValue(site, kind, module);
  const { source } = site;
  const last = value.entries.at(-1);
  if (!last) {
    const open = value.start + 1;
    const multiline = source.slice(open, value.end).includes("\n");
    const indent = lineIndent(source, value.start);
    const inline = kind === "object" ? ` ${text} ` : text;
    if (afterQueued && !multiline) {
      batch.insert(module, open, kind === "object" ? `, ${text} ` : `, ${text}`);
      return;
    }
    batch.insert(module, open, multiline ? `\n${indent}  ${text},` : inline);
    return;
  }
  const multiline = source.slice(value.start, last.start).includes("\n");
  const trailing = /^\s*,/.exec(source.slice(last.end, value.end));
  const entryIndent = lineIndent(source, last.start);
  const commaEnd = trailing ? last.end + trailing[0].length : last.end;
  const lineComment = multiline ? /^[ \t]*\/\/[^\n]*/.exec(source.slice(commaEnd)) : null;
  const insertAt = commaEnd + (lineComment?.[0].length ?? 0);
  if (trailing) {
    batch.insert(module, insertAt, multiline ? `\n${entryIndent}${text},` : ` ${text},`);
    return;
  }
  if (lineComment) {
    if (afterQueued) {
      batch.insert(module, insertAt, `,\n${entryIndent}${text}`);
      return;
    }
    batch.insert(module, last.end, ",");
    batch.insert(module, insertAt, `\n${entryIndent}${text}`);
    return;
  }
  batch.insert(module, last.end, multiline ? `,\n${entryIndent}${text}` : `, ${text}`);
}
