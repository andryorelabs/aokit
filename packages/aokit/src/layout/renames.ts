import type { Plan, PlanChange } from "../engine/plan.ts";

/** What {@link layoutRenames} pairs. */
export interface LayoutRenames {
  /** Managed files: old path to new path, as `mergeProject` takes `renames`. */
  readonly renames: ReadonlyMap<string, string>;
  /** Seed files: old path to new path, as `mergeProject` takes `seedMoves`. */
  readonly seedMoves: ReadonlyMap<string, string>;
}

function pathsByEntry(plan: Plan): Map<string, Set<string>> {
  const paths = new Map<string, Set<string>>();
  for (const change of plan.changes) {
    for (const { module, entry } of change.provenance) {
      if (entry.kind !== "file") continue;
      const key = `${module}\0${entry.from}`;
      paths.set(key, (paths.get(key) ?? new Set()).add(change.path));
    }
  }
  return paths;
}

function singleton(paths: ReadonlySet<string> | undefined): string | undefined {
  return paths?.size === 1 ? [...paths][0] : undefined;
}

function pairByProvenance(base: Plan, next: Plan): Map<string, string> {
  const baseByEntry = pathsByEntry(base);
  const nextByEntry = pathsByEntry(next);
  const candidates = new Map<string, Set<string>>();
  for (const [key, basePaths] of baseByEntry) {
    const from = singleton(basePaths);
    const to = singleton(nextByEntry.get(key));
    if (from === undefined || to === undefined || from === to) continue;
    candidates.set(from, (candidates.get(from) ?? new Set()).add(to));
  }
  const bySource = new Map<string, string>();
  for (const [from, targets] of candidates) {
    const to = singleton(targets);
    if (to !== undefined) bySource.set(from, to);
  }
  const sourcesPerTarget = new Map<string, number>();
  for (const to of bySource.values()) {
    sourcesPerTarget.set(to, (sourcesPerTarget.get(to) ?? 0) + 1);
  }
  return new Map([...bySource].filter(([, to]) => sourcesPerTarget.get(to) === 1));
}

/**
 * Pairs the files of two Renders by Provenance: a file with the same Module and the same file
 * entry in both Plans moved from its base path to its next path. Equal paths, many-to-one targets
 * and ambiguous entries are not renames. Seed files are split out as moves.
 */
export function layoutRenames(base: Plan, next: Plan): LayoutRenames {
  const nextChanges = new Map<string, PlanChange>(
    next.changes.map((change) => [change.path, change]),
  );
  const renames = new Map<string, string>();
  const seedMoves = new Map<string, string>();
  for (const [from, to] of pairByProvenance(base, next)) {
    const target = nextChanges.get(to)?.ownership === "seed" ? seedMoves : renames;
    target.set(from, to);
  }
  return { renames, seedMoves };
}
