import type { ModuleManifest } from "@aokit/module";
import { resolve } from "../../src/resolver/resolve.ts";

/** A selection of Modules, names in codepoint order. */
export type Selection = readonly string[];

function byCodepoint(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * Every non-empty subset of `manifests` the Resolver accepts as a selection on its own, without
 * applying suggestions. Subsets are ordered by size, then by their joined names.
 */
export function validSelections(manifests: readonly ModuleManifest[]): Selection[] {
  const names = manifests.map((manifest) => manifest.name).toSorted(byCodepoint);
  const selections: Selection[] = [];
  for (let mask = 1; mask < 1 << names.length; mask += 1) {
    const subset = names.filter((_, index) => (mask & (1 << index)) !== 0);
    if (resolve({ modules: subset }, manifests).ok) {
      selections.push(subset);
    }
  }
  return selections.toSorted(
    (left, right) => left.length - right.length || byCodepoint(left.join(","), right.join(",")),
  );
}

/** One pair of factor values: Module `left` in or out together with Module `right` in or out. */
function pairKeys(names: readonly string[], selection: Selection): string[] {
  const chosen = new Set(selection);
  const keys: string[] = [];
  for (const [index, left] of names.entries()) {
    for (const right of names.slice(index + 1)) {
      keys.push(`${left}=${chosen.has(left) ? 1 : 0} ${right}=${chosen.has(right) ? 1 : 0}`);
    }
  }
  return keys;
}

/** Every in/out pair of two Modules that at least one of `selections` realizes. */
export function feasiblePairs(
  names: readonly string[],
  selections: readonly Selection[],
): string[] {
  const sorted = names.toSorted(byCodepoint);
  return [...new Set(selections.flatMap((selection) => pairKeys(sorted, selection)))].toSorted(
    byCodepoint,
  );
}

/**
 * A pairwise (all-pairs) covering subset of `selections`: every in/out pair of two Modules that
 * some valid selection realizes is realized by at least one chosen selection. Greedy and
 * deterministic: each step takes the earliest selection covering the most uncovered pairs.
 */
export function pairwiseCover(
  names: readonly string[],
  selections: readonly Selection[],
): Selection[] {
  const sorted = names.toSorted(byCodepoint);
  const uncovered = new Set(feasiblePairs(sorted, selections));
  const chosen: Selection[] = [];
  while (uncovered.size > 0) {
    let best: Selection | undefined;
    let bestGain = 0;
    for (const selection of selections) {
      const gain = pairKeys(sorted, selection).filter((key) => uncovered.has(key)).length;
      if (gain > bestGain) {
        best = selection;
        bestGain = gain;
      }
    }
    if (best === undefined) {
      throw new Error("pairwise cover cannot make progress; report the issue");
    }
    chosen.push(best);
    for (const key of pairKeys(sorted, best)) {
      uncovered.delete(key);
    }
  }
  return chosen.toSorted(
    (left, right) => left.length - right.length || byCodepoint(left.join(","), right.join(",")),
  );
}
