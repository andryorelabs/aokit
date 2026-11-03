import { mergeJsonStructurally } from "./json.ts";
import {
  MERGE_LABELS,
  mergeTextWithDiff3,
  normalizeLineEndings,
  type MergeFileFn,
  type TextMergeResult,
} from "./text.ts";

export type { MergeFileFn };

const BINARY_SNIFF_BYTES = 8192;

/** The result of merging a single file. */
interface MergeOutcome {
  readonly content: string | null;
  readonly conflict: boolean;
  readonly aokitNew?: string;
}

/** The inputs of a single file merge. */
interface MergeInput {
  readonly base: string;
  readonly user: string;
  readonly next: string;
  readonly path: string;
}

/** A per-file three-way merger. */
export interface Merger {
  merge(input: MergeInput): Promise<MergeOutcome>;
}

/** Options for {@link createMerger}. */
export interface MergerOptions {
  readonly git?: { readonly mergeFile: MergeFileFn };
}

/** Detects binary content by a NUL byte in the first 8 KB. */
export function isBinary(content: string): boolean {
  return content.slice(0, BINARY_SNIFF_BYTES).includes("\0");
}

function mergeBinary({ base, user, next }: MergeInput): MergeOutcome {
  if (next === user || next === base) return { content: user, conflict: false };
  return { content: user, conflict: true, aokitNew: next };
}

/** Creates a Merger backed by `git merge-file` when `git` is injected, otherwise by `node-diff3`. */
export function createMerger(options: MergerOptions = {}): Merger {
  const mergeText = async (base: string, user: string, next: string): Promise<TextMergeResult> => {
    if (user === next || base === next) return { content: user, conflict: false };
    if (base === user) return { content: next, conflict: false };
    return options.git
      ? options.git.mergeFile(base, user, next, MERGE_LABELS)
      : mergeTextWithDiff3(base, user, next, MERGE_LABELS);
  };

  return {
    async merge(input) {
      if ([input.base, input.user, input.next].some(isBinary)) return mergeBinary(input);
      const base = normalizeLineEndings(input.base);
      const user = normalizeLineEndings(input.user);
      const next = normalizeLineEndings(input.next);
      if (input.path.endsWith(".json") && user !== next && base !== next && base !== user) {
        const structural = mergeJsonStructurally(base, user, next);
        if (structural !== undefined) return { content: structural, conflict: false };
      }
      const result = await mergeText(base, user, next);
      return { content: result.content, conflict: result.conflict };
    },
  };
}
