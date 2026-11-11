/**
 * Compares strings by Unicode codepoint, independent of UTF-16 surrogate ordering.
 */
export function compareCodepoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const difference =
      (leftPoints[index]?.codePointAt(0) ?? 0) - (rightPoints[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

/**
 * Result of ordering: a topological list, or the names forming a cycle.
 */
export type OrderOutcome =
  | { readonly kind: "ordered"; readonly names: readonly string[] }
  | { readonly kind: "cycle"; readonly cycle: readonly string[] };

type Dependencies = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Orders names so every dependency precedes its dependents; ties break by codepoint order.
 * `dependencies` maps a name to the names it must come after.
 */
export function orderTopologically(
  names: readonly string[],
  dependencies: Dependencies,
): OrderOutcome {
  const remaining = new Set(names);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((name) => [...(dependencies.get(name) ?? [])].every((entry) => !remaining.has(entry)))
      .toSorted(compareCodepoints);
    const next = ready[0];
    if (next === undefined) {
      return { kind: "cycle", cycle: findCycle(remaining, dependencies) };
    }
    ordered.push(next);
    remaining.delete(next);
  }
  return { kind: "ordered", names: ordered };
}

function findCycle(remaining: ReadonlySet<string>, dependencies: Dependencies): readonly string[] {
  const path: string[] = [];
  let name = [...remaining].toSorted(compareCodepoints)[0] ?? "";
  while (!path.includes(name)) {
    path.push(name);
    name =
      [...(dependencies.get(name) ?? [])]
        .filter((entry) => remaining.has(entry))
        .toSorted(compareCodepoints)[0] ?? name;
  }
  return [...path.slice(path.indexOf(name)), name];
}
