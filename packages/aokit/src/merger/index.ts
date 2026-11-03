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
  readonly aokitNew?: string | Uint8Array;
}

/** File content as the VFS holds it: text or raw bytes. */
type FileContent = string | Uint8Array;

/** The inputs of a single file merge. */
interface MergeInput {
  readonly base: FileContent;
  readonly user: FileContent;
  readonly next: FileContent;
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
export function isBinary(content: FileContent): boolean {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function sameContent(left: FileContent, right: FileContent): boolean {
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

function mergeBinary({ base, user, next }: MergeInput): MergeOutcome {
  if (sameContent(next, user) || sameContent(next, base)) {
    return { content: toText(user), conflict: false };
  }
  return { content: toText(user), conflict: true, aokitNew: next };
}

function toText(content: FileContent): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
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
      const base = normalizeLineEndings(toText(input.base));
      const user = normalizeLineEndings(toText(input.user));
      const next = normalizeLineEndings(toText(input.next));
      if (input.path.endsWith(".json") && user !== next && base !== next && base !== user) {
        const structural = mergeJsonStructurally(base, user, next);
        if (structural !== undefined) return { content: structural, conflict: false };
      }
      const result = await mergeText(base, user, next);
      return { content: result.content, conflict: result.conflict };
    },
  };
}
