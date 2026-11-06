import { type EditBatch, createEditBatch } from "./batch.ts";
import { EditError } from "./errors.ts";

/** Per-file edit batches shared by every Module of one build. */
export interface EditSession {
  /** The open batch of `path`, created from the file's current content on first use. */
  batchFor(path: string, module: string): EditBatch;
  /** Applies and writes the batch of `path`, or of every open file when omitted. */
  flush(path?: string): void;
}

/** Options for {@link createEditSession}. */
export interface EditSessionOptions {
  /** Module names in canonical order; decides same-offset insert order. */
  readonly moduleOrder: readonly string[];
  readonly read: (path: string) => string | undefined;
  readonly write: (path: string, content: string) => void;
  /** Called once per edit with the Module that contributed it. */
  readonly onEdit?: (path: string, module: string) => void;
}

interface OpenBatch {
  readonly source: string;
  readonly batch: EditBatch;
}

/**
 * Collects the edits of all Modules to a file into one batch in original offsets. Flushing
 * applies the batch against the content it was opened with and writes the result when it changed.
 */
export function createEditSession(options: EditSessionOptions): EditSession {
  const open = new Map<string, OpenBatch>();

  function openBatch(path: string): OpenBatch {
    const existing = open.get(path);
    if (existing) {
      return existing;
    }
    const source = options.read(path);
    if (source === undefined) {
      throw new EditError("edit.out-of-range", `Cannot edit ${path}: no text content.`, path);
    }
    const inner = createEditBatch({
      fileName: path,
      source,
      moduleOrder: options.moduleOrder,
    });
    const batch: EditBatch = {
      insert(module, offset, text) {
        inner.insert(module, offset, text);
        options.onEdit?.(path, module);
      },
      replace(module, start, end, text) {
        inner.replace(module, start, end, text);
        options.onEdit?.(path, module);
      },
      apply: () => inner.apply(),
    };
    const created = { source, batch };
    open.set(path, created);
    return created;
  }

  function flushOne(path: string): void {
    const pending = open.get(path);
    if (!pending) {
      return;
    }
    open.delete(path);
    const result = pending.batch.apply();
    if (result !== pending.source) {
      options.write(path, result);
    }
  }

  return {
    batchFor: (path) => openBatch(path).batch,
    flush(path) {
      if (path !== undefined) {
        flushOne(path);
        return;
      }
      for (const openPath of open.keys()) {
        flushOne(openPath);
      }
    },
  };
}
