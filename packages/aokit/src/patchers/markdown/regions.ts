/** Raised when Region markers are malformed: a start without an end, or a repeated id. */
export class RegionSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegionSyntaxError";
  }
}

/** One aokit Region: `start` is the begin marker's offset, `end` the offset after the end marker. */
export interface RegionSpan {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly body: string;
}

/** Where a new Region goes when its id is not yet in the file. */
export type RegionPlacement = "afterLastRegion" | "top";

const regionFileNames: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md"]);

/** A Region file is exactly the root `AGENTS.md` or `CLAUDE.md`. */
export function isRegionFile(path: string): boolean {
  return regionFileNames.has(path);
}

function beginMarker(id: string): string {
  return `<!-- aokit:begin ${id} -->`;
}

function endMarker(id: string): string {
  return `<!-- aokit:end ${id} -->`;
}

function blockOf(id: string, content: string): string {
  return `${beginMarker(id)}\n${content}\n${endMarker(id)}`;
}

/** Parses every aokit Region; throws {@link RegionSyntaxError} on a missing end or a repeated id. */
export function parseRegions(text: string): readonly RegionSpan[] {
  const spans: RegionSpan[] = [];
  const seen = new Set<string>();
  const beginPattern = /<!-- aokit:begin (\S+) -->/g;
  let match = beginPattern.exec(text);
  while (match !== null) {
    const id = match[1] ?? "";
    if (seen.has(id)) throw new RegionSyntaxError(`Region "${id}" is declared more than once`);
    seen.add(id);
    const end = endMarker(id);
    const bodyStart = match.index + match[0].length;
    const endIndex = text.indexOf(end, bodyStart);
    if (endIndex === -1) {
      throw new RegionSyntaxError(`Region "${id}" has a start marker but no end marker`);
    }
    spans.push({
      id,
      start: match.index,
      end: endIndex + end.length,
      body: text
        .slice(bodyStart, endIndex)
        .replace(/^\r?\n/, "")
        .replace(/\r?\n$/, ""),
    });
    beginPattern.lastIndex = endIndex + end.length;
    match = beginPattern.exec(text);
  }
  return spans;
}

/** Replaces the Region in place, or inserts it per `placement` when absent. */
export function upsertRegion(
  text: string,
  region: { readonly id: string; readonly content: string },
  placement: RegionPlacement,
): string {
  const spans = parseRegions(text);
  const block = blockOf(region.id, region.content);
  const existing = spans.find((span) => span.id === region.id);
  if (existing !== undefined) {
    return `${text.slice(0, existing.start)}${block}${text.slice(existing.end)}`;
  }
  if (placement === "top") return text === "" ? `${block}\n` : `${block}\n\n${text}`;
  const last = spans.at(-1);
  if (last !== undefined) return `${text.slice(0, last.end)}\n\n${block}${text.slice(last.end)}`;
  const separator =
    text === "" ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${separator}${block}\n`;
}

/** Removes the Region and one blank-line separator; an absent id leaves the text unchanged. */
export function removeRegion(text: string, id: string): string {
  const span = parseRegions(text).find((candidate) => candidate.id === id);
  if (span === undefined) return text;
  const head = text.slice(0, span.start);
  const tail = text.slice(span.end).replace(/^(?:\r?\n){1,2}/, "");
  if (tail === "") return head === "" ? "" : `${head.replace(/(?:\r?\n)+$/, "")}\n`;
  return `${head}${tail}`;
}

/**
 * Copies every aokit Region of the rendered file into the user's file. Existing Regions are
 * replaced in place, a new Region that leads the rendered file goes to the top, any other
 * goes after the last Region, and text outside markers is never touched.
 */
export function spliceRegions(user: string, rendered: string): string {
  let result = user;
  for (const span of parseRegions(rendered)) {
    const placement: RegionPlacement = span.start === 0 ? "top" : "afterLastRegion";
    result = upsertRegion(result, { id: span.id, content: span.body }, placement);
  }
  return result;
}

/** The line-ending-normalized aokit Regions of a file, in order, as one string. */
export function regionDigest(text: string): string {
  const normalized = text.replaceAll(/\r\n?/g, "\n");
  return parseRegions(normalized)
    .map((span) => normalized.slice(span.start, span.end))
    .join("\n");
}
