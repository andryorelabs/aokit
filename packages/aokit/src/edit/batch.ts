import { MagicString } from "magic-string";
import { EditError } from "./errors.ts";

/** A text change expressed in original-source offsets. */
interface SourceEdit {
  readonly module: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface OrderedEdit extends SourceEdit {
  readonly rank: number;
  readonly sequence: number;
}

/** One batch of edits to a single file, from all Modules. */
export interface EditBatch {
  /** Inserts `text` at `offset` of the original source. */
  insert(module: string, offset: number, text: string): void;
  /** Replaces `[start, end)` of the original source with `text`. */
  replace(module: string, start: number, end: number, text: string): void;
  /** Validates the batch and splices it against the original source. */
  apply(): string;
}

/** Options for {@link createEditBatch}. */
export interface EditBatchOptions {
  readonly fileName: string;
  readonly source: string;
  /** Module names in canonical order; decides same-offset insert order. */
  readonly moduleOrder: readonly string[];
}

function compareEdits(left: OrderedEdit, right: OrderedEdit): number {
  return (
    left.start - right.start ||
    left.end - right.end ||
    left.rank - right.rank ||
    left.sequence - right.sequence
  );
}

function overlapError(fileName: string, first: OrderedEdit, second: OrderedEdit): EditError {
  return new EditError(
    "edit.overlap",
    `Overlapping edits in ${fileName}: Module "${first.module}" edits ${first.start}-${first.end} and Module "${second.module}" edits ${second.start}-${second.end}.`,
    fileName,
    [first.module, second.module],
  );
}

/**
 * Collects edits to one file in original offsets, rejects overlaps, orders
 * same-offset inserts by canonical Module order and splices with magic-string.
 */
export function createEditBatch(options: EditBatchOptions): EditBatch {
  const { fileName, source, moduleOrder } = options;
  const edits: OrderedEdit[] = [];

  function add(module: string, start: number, end: number, text: string): void {
    const rank = moduleOrder.indexOf(module);
    if (rank === -1) {
      throw new EditError(
        "edit.unknown-module",
        `Module "${module}" is not in the canonical Module order for ${fileName}.`,
        fileName,
        [module],
      );
    }
    const valid =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end >= start &&
      end <= source.length;
    if (!valid) {
      throw new EditError(
        "edit.out-of-range",
        `Module "${module}" edits ${start}-${end}, outside ${fileName} (length ${source.length}).`,
        fileName,
        [module],
      );
    }
    edits.push({ module, start, end, text, rank, sequence: edits.length });
  }

  function validate(sorted: readonly OrderedEdit[]): void {
    let reach: OrderedEdit | undefined;
    for (const edit of sorted) {
      if (reach && edit.start < reach.end) {
        throw overlapError(fileName, reach, edit);
      }
      if (!reach || edit.end > reach.end) {
        reach = edit;
      }
    }
  }

  return {
    insert: (module, offset, text) => add(module, offset, offset, text),
    replace: (module, start, end, text) => add(module, start, end, text),
    apply() {
      const sorted = edits.toSorted(compareEdits);
      validate(sorted);
      const magic = new MagicString(source);
      for (const edit of sorted) {
        if (edit.start === edit.end) {
          magic.appendLeft(edit.start, edit.text);
        } else if (edit.text === "") {
          magic.remove(edit.start, edit.end);
        } else {
          magic.update(edit.start, edit.end, edit.text);
        }
      }
      return magic.toString();
    },
  };
}
