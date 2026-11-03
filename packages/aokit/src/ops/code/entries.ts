import type { createEditBatch } from "../../edit/batch.ts";
import { CodeOpError } from "./errors.ts";
import type { AnchorSite } from "./resolve.ts";

const keyPattern = /^(?:\[\s*)?(?:"([^"]*)"|'([^']*)'|([A-Za-z_$][\w$]*))\s*\]?\s*(?::|\(|,|$)/;

function squash(text: string): string {
  return text.replaceAll(/\s+/g, "");
}

function entryKey(entrySource: string): string | undefined {
  const match = keyPattern.exec(entrySource);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function entrySources(site: AnchorSite): string[] {
  return (site.anchor.value?.entries ?? []).map((entry) =>
    site.source.slice(entry.start, entry.end),
  );
}

/** True when the anchor already has an entry whose text equals `text` ignoring whitespace. */
export function hasEntryText(site: AnchorSite, text: string): boolean {
  const wanted = squash(text);
  return entrySources(site).some((existing) => squash(existing) === wanted);
}

/** The source text of the anchor object's property named `key`, if it has one. */
export function findEntryByKey(site: AnchorSite, key: string): string | undefined {
  const wanted = key.replace(/^(["'])(.*)\1$/, "$2");
  return entrySources(site).find((existing) => entryKey(existing) === wanted);
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

/** Appends `text` as the last entry of the anchor's array or object literal. */
export function appendEntry(
  batch: ReturnType<typeof createEditBatch>,
  site: AnchorSite,
  module: string,
  kind: "array" | "object",
  text: string,
): void {
  const value = requireValue(site, kind, module);
  const { source } = site;
  const last = value.entries.at(-1);
  if (!last) {
    const open = value.start + 1;
    const multiline = source.slice(open, value.end).includes("\n");
    const indent = lineIndent(source, value.start);
    const inline = kind === "object" ? ` ${text} ` : text;
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
    batch.insert(module, last.end, ",");
    batch.insert(module, insertAt, `\n${entryIndent}${text}`);
    return;
  }
  batch.insert(module, last.end, multiline ? `,\n${entryIndent}${text}` : `, ${text}`);
}
