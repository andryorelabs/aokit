import {
  parseRegions,
  removeRegion,
  upsertRegion,
  type RegionSpan,
} from "../patchers/markdown/regions.ts";
import type { TextMergeResult } from "./text.ts";

/** A three-way text merge, injected so Region bodies use the same engine as every other file. */
export type MergeText = (base: string, user: string, next: string) => Promise<TextMergeResult>;

/** A Region merge result; `unparseable` marks a user file whose markers cannot be parsed. */
export interface RegionMergeResult extends TextMergeResult {
  readonly unparseable?: true;
}

/** The three sides of a Region file. */
export interface RegionMergeInput {
  readonly base: string;
  readonly user: string;
  readonly next: string;
}

function parseOrEmpty(text: string): readonly RegionSpan[] {
  try {
    return parseRegions(text);
  } catch {
    return [];
  }
}

function bodiesById(spans: readonly RegionSpan[]): ReadonlyMap<string, string> {
  return new Map(spans.map((span) => [span.id, span.body]));
}

/** Inserts a new Region after the closest earlier Region of the next Render that the text has. */
function insertRegion(
  text: string,
  nextSpans: readonly RegionSpan[],
  index: number,
  body: string,
): string {
  const span = nextSpans[index];
  if (span === undefined) return text;
  const present = new Set(parseRegions(text).map((candidate) => candidate.id));
  const region = { id: span.id, content: body };
  if (span.start === 0) return upsertRegion(text, region, "top");
  const earlier = nextSpans.slice(0, index).findLast((candidate) => present.has(candidate.id));
  if (earlier === undefined) return upsertRegion(text, region, "afterLastRegion");
  const anchor = parseRegions(text).find((candidate) => candidate.id === earlier.id);
  if (anchor === undefined) return upsertRegion(text, region, "afterLastRegion");
  const head = text.slice(0, anchor.end);
  const tail = text.slice(anchor.end);
  const block = upsertRegion("", region, "afterLastRegion").trimEnd();
  return `${head}\n\n${block}${tail}`;
}

/**
 * Drops lines of an adopted user file that repeat a one-line Region body (such as the `@AGENTS.md`
 * import in `CLAUDE.md`), so the Region does not duplicate them.
 */
function withoutDuplicateImports(user: string, nextSpans: readonly RegionSpan[]): string {
  const oneLiners = new Set(
    nextSpans.map((span) => span.body.trim()).filter((body) => body !== "" && !body.includes("\n")),
  );
  if (oneLiners.size === 0) return user;
  const kept = user.split("\n").filter((line) => !oneLiners.has(line.trim()));
  return kept.join("\n").replace(/^\n+/, "");
}

/**
 * Merges a Region file Region by Region: unedited Regions take their next content, Regions absent
 * from next are removed, new Regions are inserted after their closest earlier neighbour, and an
 * edited Region is three-way merged alone. Text outside markers is never changed. Unparseable
 * markers in the user's file give a Conflict.
 */
export async function mergeRegionFile(
  { base, user, next }: RegionMergeInput,
  mergeText: MergeText,
): Promise<RegionMergeResult> {
  let userSpans: readonly RegionSpan[];
  try {
    userSpans = parseRegions(user);
  } catch {
    return { content: user, conflict: true, unparseable: true };
  }
  const nextSpans = parseRegions(next);
  const adopted = userSpans.length === 0 ? withoutDuplicateImports(user, parseRegions(next)) : user;
  const baseBodies = bodiesById(parseOrEmpty(base));
  const nextIds = new Set(nextSpans.map((span) => span.id));
  const nextBodies = bodiesById(nextSpans);
  let conflict = false;

  const mergeBody = async (span: RegionSpan): Promise<string> => {
    const nextBody = nextBodies.get(span.id) ?? "";
    const baseBody = baseBodies.get(span.id);
    if (span.body === nextBody) return span.body;
    if (baseBody === span.body) return nextBody;
    const result = await mergeText(baseBody ?? "", span.body, nextBody);
    conflict ||= result.conflict;
    return result.content.replace(/\n$/, "");
  };

  const merged = new Map(
    await Promise.all(
      userSpans.map(async (span): Promise<[string, string]> => [span.id, await mergeBody(span)]),
    ),
  );
  let text = adopted;
  for (const span of userSpans) {
    if (nextIds.has(span.id)) continue;
    const baseBody = baseBodies.get(span.id);
    if (baseBody === undefined) continue;
    text =
      baseBody === span.body
        ? removeRegion(text, span.id)
        : upsertRegion(
            text,
            { id: span.id, content: merged.get(span.id) ?? "" },
            "afterLastRegion",
          );
  }

  for (const [index, nextSpan] of nextSpans.entries()) {
    const mergedBody = merged.get(nextSpan.id);
    text =
      mergedBody === undefined
        ? insertRegion(text, nextSpans, index, nextSpan.body)
        : upsertRegion(text, { id: nextSpan.id, content: mergedBody }, "afterLastRegion");
  }
  return { content: text, conflict };
}
