import type { EditBatch } from "../../edit/batch.ts";

/** What one Module-independent batch already holds, so later Ops can skip duplicates. */
export interface QueuedEdits {
  /** Entry texts appended to each anchor, by anchor name. */
  readonly entries: Map<string, string[]>;
  /** Import parts queued per module specifier. */
  readonly imports: Map<string, QueuedImport>;
}

/** The parts of an import already queued for one module specifier. */
export interface QueuedImport {
  readonly named: Set<string>;
  hasDefault: boolean;
  hasNamespace: boolean;
}

const ledgers = new WeakMap<EditBatch, QueuedEdits>();

/** The queued-edit ledger of an open batch; it ends when the batch is flushed. */
export function ledgerOf(batch: EditBatch): QueuedEdits {
  let ledger = ledgers.get(batch);
  if (!ledger) {
    ledger = { entries: new Map(), imports: new Map() };
    ledgers.set(batch, ledger);
  }
  return ledger;
}

/** The queued import parts for `from`, created on first use. */
export function queuedImport(batch: EditBatch, from: string): QueuedImport {
  const { imports } = ledgerOf(batch);
  let queued = imports.get(from);
  if (!queued) {
    queued = { named: new Set(), hasDefault: false, hasNamespace: false };
    imports.set(from, queued);
  }
  return queued;
}
