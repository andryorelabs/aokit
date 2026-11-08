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

const fenceOpenPattern = /^ {0,3}(`{3,}|~{3,})/;

/** Blanks the content of fenced code blocks, keeping every offset and line break in place. */
function maskFencedCode(text: string): string {
  let fenceCharacter: string | undefined;
  let fenceLength = 0;
  const masked: string[] = [];
  for (const line of text.split("\n")) {
    const bare = line.replace(/\r$/, "");
    if (fenceCharacter === undefined) {
      const marker = fenceOpenPattern.exec(bare)?.[1];
      if (marker === undefined) {
        masked.push(line);
        continue;
      }
      fenceCharacter = marker.charAt(0);
      fenceLength = marker.length;
    } else if (new RegExp(`^ {0,3}${fenceCharacter}{${fenceLength},}\\s*$`).test(bare)) {
      fenceCharacter = undefined;
    }
    masked.push(line.replaceAll(/[^\r]/g, " "));
  }
  return masked.join("\n");
}

/** How a file type spells Region markers. */
export interface MarkerSyntax {
  begin(id: string): string;
  end(id: string): string;
}

interface Syntax extends MarkerSyntax {
  readonly anchored: boolean;
  readonly beginPattern: () => RegExp;
  readonly mask: (text: string) => string;
}

const slashExtensions = /\.(?:prisma|[cm]?[jt]sx?)$/;
const htmlExtensions = /\.mdx?$/;

function commentSyntax(prefix: string, mask: (text: string) => string): Syntax {
  const escaped = prefix.replaceAll(/[/#]/g, String.raw`\$&`);
  return {
    anchored: true,
    begin: (id) => `${prefix} aokit:begin ${id}`,
    end: (id) => `${prefix} aokit:end ${id}`,
    beginPattern: () =>
      new RegExp(`(?<=^[ \\t]*)${escaped} aokit:begin (\\S+)(?=[ \\t]*\\r?$)`, "gm"),
    mask,
  };
}

const identity = (text: string): string => text;

function blank(text: string): string {
  return text.replaceAll(/[^\r\n]/g, " ");
}

/** True when a `/` after the scanned prefix opens a regex literal rather than a division. */
function startsRegexLiteral(scanned: string): boolean {
  const before = scanned.trimEnd();
  if (before === "") return true;
  return /[(,=:[!&|?{};]$/.test(before) || /(?:^|[^\w$])(?:return|typeof|case)$/.test(before);
}

/** Offset just after the regex literal that starts at `start`, or after the `/` when it is unclosed. */
function regexLiteralEnd(text: string, start: number): number {
  let cursor = start + 1;
  let inClass = false;
  while (cursor < text.length) {
    const character = text.charAt(cursor);
    if (character === "\n") return start + 1;
    if (character === "\\") cursor += 1;
    else if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) return cursor + 1;
    cursor += 1;
  }
  return start + 1;
}

/** Blanks the content of string literals, keeping comments, offsets and line breaks in place. */
function maskStringLiterals(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    const character = text.charAt(index);
    const pair = text.slice(index, index + 2);
    if (pair === "//") {
      const lineEnd = text.indexOf("\n", index);
      const stop = lineEnd === -1 ? text.length : lineEnd;
      result += text.slice(index, stop);
      index = stop;
    } else if (pair === "/*") {
      const close = text.indexOf("*/", index + 2);
      const stop = close === -1 ? text.length : close + 2;
      result += text.slice(index, stop);
      index = stop;
    } else if (character === "/" && startsRegexLiteral(result)) {
      const stop = regexLiteralEnd(text, index);
      result += text.slice(index, stop);
      index = stop;
    } else if (character === '"' || character === "'" || character === "`") {
      let cursor = index + 1;
      while (cursor < text.length && text.charAt(cursor) !== character) {
        if (text.charAt(cursor) === "\\") cursor += 1;
        else if (character !== "`" && text.charAt(cursor) === "\n") break;
        cursor += 1;
      }
      const stop = Math.min(cursor + 1, text.length);
      result += character + blank(text.slice(index + 1, stop - 1)) + text.slice(stop - 1, stop);
      index = stop;
    } else {
      result += character;
      index += 1;
    }
  }
  return result;
}

const htmlSyntax: Syntax = {
  anchored: false,
  begin: (id) => `<!-- aokit:begin ${id} -->`,
  end: (id) => `<!-- aokit:end ${id} -->`,
  beginPattern: () => /<!-- aokit:begin (\S+) -->/g,
  mask: maskFencedCode,
};
const slashSyntax = commentSyntax("//", maskStringLiterals);
const hashSyntax = commentSyntax("#", identity);

function isHashFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /^\.[^.]+$/.test(name) || /^\.env(?:\..+)?$/.test(name) || /\.(?:ya?ml|toml)$/.test(name)
    ? true
    : !name.includes(".");
}

function syntaxOf(path: string | undefined): Syntax {
  if (path === undefined || htmlExtensions.test(path)) return htmlSyntax;
  if (slashExtensions.test(path)) return slashSyntax;
  if (isHashFile(path)) return hashSyntax;
  throw new RegionSyntaxError(
    `Regions are not supported in "${path}": only Markdown, JavaScript-family, prisma, ignore, .env, yml, toml and extensionless files can hold them.`,
  );
}

/**
 * The Region marker spelling for a file path: `<!-- -->` for md/mdx, `//` for prisma and
 * JavaScript-family files, `#` for everything else (ignore files, `.env*`, yml, toml,
 * extensionless).
 */
export function markerSyntaxFor(path: string): MarkerSyntax {
  const syntax = syntaxOf(path);
  return { begin: (id) => syntax.begin(id), end: (id) => syntax.end(id) };
}

function blockOf(syntax: Syntax, id: string, content: string): string {
  return `${syntax.begin(id)}\n${content}\n${syntax.end(id)}`;
}

function findEnd(syntax: Syntax, scanned: string, end: string, from: number): number {
  let index = scanned.indexOf(end, from);
  while (index !== -1 && syntax.anchored) {
    const lineStart = scanned.lastIndexOf("\n", index - 1) + 1;
    const after = scanned.slice(index + end.length).match(/^[ \t]*(?:\r?\n|$)/);
    if (/^[ \t]*$/.test(scanned.slice(lineStart, index)) && after !== null) break;
    index = scanned.indexOf(end, index + end.length);
  }
  return index;
}

/**
 * Parses every aokit Region outside fenced code blocks (Markdown) or string literals (comment
 * syntaxes); throws {@link RegionSyntaxError} on a missing end or a repeated id.
 */
export function parseRegions(text: string, path?: string): readonly RegionSpan[] {
  const syntax = syntaxOf(path);
  const spans: RegionSpan[] = [];
  const seen = new Set<string>();
  const scanned = syntax.mask(text);
  const beginPattern = syntax.beginPattern();
  let match = beginPattern.exec(scanned);
  while (match !== null) {
    const id = match[1] ?? "";
    if (seen.has(id)) throw new RegionSyntaxError(`Region "${id}" is declared more than once`);
    seen.add(id);
    const end = syntax.end(id);
    const bodyStart = match.index + match[0].length;
    const endIndex = findEnd(syntax, scanned, end, bodyStart);
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
    match = beginPattern.exec(scanned);
  }
  return spans;
}

/** Replaces the Region in place, or inserts it per `placement` when absent. */
export function upsertRegion(
  text: string,
  region: { readonly id: string; readonly content: string },
  placement: RegionPlacement,
  path?: string,
): string {
  const spans = parseRegions(text, path);
  const block = blockOf(syntaxOf(path), region.id, region.content);
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
export function removeRegion(text: string, id: string, path?: string): string {
  const span = parseRegions(text, path).find((candidate) => candidate.id === id);
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
export function spliceRegions(user: string, rendered: string, path?: string): string {
  let result = user;
  for (const span of parseRegions(rendered, path)) {
    const placement: RegionPlacement = span.start === 0 ? "top" : "afterLastRegion";
    result = upsertRegion(result, { id: span.id, content: span.body }, placement, path);
  }
  return result;
}

/** The line-ending-normalized aokit Regions of a file, in order, as one string. */
export function regionDigest(text: string, path?: string): string {
  const normalized = text.replaceAll(/\r\n?/g, "\n");
  return parseRegions(normalized, path)
    .map((span) => normalized.slice(span.start, span.end))
    .join("\n");
}
