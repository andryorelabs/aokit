/** A selection of Modules, names in codepoint order. */
export type Selection = readonly string[];

/** What the cover needs to know about one Resolver run: whether it accepted, and who could fix it. */
interface ResolveOutcome {
  readonly ok: boolean;
  readonly error?: { readonly providers?: readonly string[] } | undefined;
}

/** Runs the Resolver on a selection of Module names, without applying suggestions. */
export type ResolveSelection = (modules: string[]) => ResolveOutcome;

/** The most provider alternatives followed for one Module's requirements. */
const maxClosuresPerModule = 4;

function byCodepoint(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function bySizeThenNames(left: Selection, right: Selection): number {
  return left.length - right.length || byCodepoint(left.join(","), right.join(","));
}

function uniqueSelections(selections: readonly Selection[]): Selection[] {
  const byKey = new Map<string, Selection>();
  for (const selection of selections) {
    byKey.set(selection.join(","), selection);
  }
  return [...byKey.values()];
}

/**
 * The selections that satisfy `name` and everything it requires, one per provider alternative.
 * Every step adds a Module that is not yet selected, so the walk ends; a requirement nobody can
 * provide, a conflict or a cardinality error is a dead end and contributes no closure.
 */
function closuresOf(name: string, resolveSelection: ResolveSelection): Selection[] {
  const closures: Selection[] = [];
  const seen = new Set<string>();
  const pending: Selection[] = [[name]];
  while (pending.length > 0 && closures.length < maxClosuresPerModule) {
    const current = pending.shift();
    if (current === undefined) break;
    const key = current.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const outcome = resolveSelection([...current]);
    if (outcome.ok) {
      closures.push(current);
      continue;
    }
    for (const provider of outcome.error?.providers ?? []) {
      if (!current.includes(provider)) {
        pending.push([...current, provider].toSorted(byCodepoint));
      }
    }
  }
  return closures;
}

function candidateSelections(
  names: readonly string[],
  resolveSelection: ResolveSelection,
): Selection[] {
  const closures = names.flatMap((name) => closuresOf(name, resolveSelection));
  const unions: Selection[] = [];
  for (const [index, left] of closures.entries()) {
    for (const right of closures.slice(index + 1)) {
      const union = [...new Set([...left, ...right])].toSorted(byCodepoint);
      if (union.length > left.length && union.length > right.length) {
        if (resolveSelection(union).ok) unions.push(union);
      }
    }
  }
  return uniqueSelections([...closures, ...unions]);
}

function pairIds(names: readonly string[], selection: Selection): Set<number> {
  const chosen = new Set(selection);
  const ids = new Set<number>();
  for (const [leftIndex, left] of names.entries()) {
    for (let rightIndex = leftIndex + 1; rightIndex < names.length; rightIndex += 1) {
      const right = names[rightIndex] ?? "";
      const state = (chosen.has(left) ? 2 : 0) + (chosen.has(right) ? 1 : 0);
      ids.add((leftIndex * names.length + rightIndex) * 4 + state);
    }
  }
  return ids;
}

/**
 * A constructive pairwise (all-pairs) cover: for each Module its closure under `requires` (one per
 * provider alternative); a union of two closures joins the candidates when the Resolver accepts
 * it. Candidates are picked greedily until every in/out pair of two Modules that some candidate
 * realizes is realized by a chosen selection. Deterministic, and a Module whose requirements
 * cannot be met is skipped instead of looping.
 */
export function pairwiseSelections(
  names: readonly string[],
  resolveSelection: ResolveSelection,
): string[][] {
  const sorted = names.toSorted(byCodepoint);
  const candidates = candidateSelections(sorted, resolveSelection).toSorted(bySizeThenNames);
  const idsPerCandidate = candidates.map((candidate) => pairIds(sorted, candidate));
  const uncovered = new Set(idsPerCandidate.flatMap((ids) => [...ids]));
  const chosen: Selection[] = [];
  while (uncovered.size > 0) {
    let bestIndex = -1;
    let bestGain = 0;
    for (const [index, ids] of idsPerCandidate.entries()) {
      let gain = 0;
      for (const id of ids) {
        if (uncovered.has(id)) gain += 1;
      }
      if (gain > bestGain) {
        bestIndex = index;
        bestGain = gain;
      }
    }
    const best = candidates[bestIndex];
    if (best === undefined) {
      throw new Error("pairwise cover cannot make progress; report the issue");
    }
    chosen.push(best);
    for (const id of idsPerCandidate[bestIndex] ?? []) {
      uncovered.delete(id);
    }
  }
  return chosen.toSorted(bySizeThenNames).map((selection) => selection.slice());
}
