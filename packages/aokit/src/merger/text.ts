import { diff3Merge } from "node-diff3";

/** Marker labels passed to every text merge implementation. */
export interface MergeLabels {
  readonly base: string;
  readonly user: string;
  readonly new: string;
}

/** The outcome of a single text merge. */
export interface TextMergeResult {
  readonly content: string;
  readonly conflict: boolean;
}

/** The injected git `merge-file` function, shaped like the git adapter's `mergeFile`. */
export type MergeFileFn = (
  base: string,
  user: string,
  next: string,
  labels: MergeLabels,
) => Promise<TextMergeResult>;

/** The default marker labels. */
export const MERGE_LABELS: MergeLabels = { base: "base", user: "user", new: "new" };

/** Normalizes CRLF and lone CR line endings to LF. */
export function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function splitLines(content: string): string[] {
  if (content === "") return [];
  return (content.endsWith("\n") ? content.slice(0, -1) : content).split("\n");
}

function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  if (lines.length === 0) return "";
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

/** Three-way text merge in pure TypeScript, emitting git's diff3 marker format. */
export function mergeTextWithDiff3(
  base: string,
  user: string,
  next: string,
  labels: MergeLabels = MERGE_LABELS,
): TextMergeResult {
  const regions = diff3Merge(splitLines(user), splitLines(base), splitLines(next), {
    excludeFalseConflicts: true,
  });
  const output: string[] = [];
  let conflict = false;
  for (const region of regions) {
    if (region.ok) {
      output.push(...region.ok);
      continue;
    }
    if (!region.conflict) continue;
    conflict = true;
    output.push(
      `<<<<<<< ${labels.user}`,
      ...region.conflict.a,
      `||||||| ${labels.base}`,
      ...region.conflict.o,
      "=======",
      ...region.conflict.b,
      `>>>>>>> ${labels.new}`,
    );
  }
  const trailingNewline = [base, user, next].some((side) => side.endsWith("\n"));
  return { content: joinLines(output, trailingNewline), conflict };
}
