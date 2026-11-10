function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      const substitution = (previous[column - 1] ?? 0) + cost;
      const insertion = (current[column - 1] ?? 0) + 1;
      const deletion = (previous[column] ?? 0) + 1;
      current.push(Math.min(substitution, insertion, deletion));
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
}

function maxDistance(name: string): number {
  return Math.min(3, Math.max(1, Math.floor(name.length / 3)));
}

/**
 * The known Module name closest to a mistyped one, or `undefined` when nothing is close.
 * Closeness is edit distance, or one name containing the other (at least 3 characters);
 * ties break on the lexicographically first name.
 */
export function suggestModuleName(name: string, known: readonly string[]): string | undefined {
  const needle = name.toLowerCase();
  let best: { readonly name: string; readonly distance: number } | undefined;
  for (const candidate of [...known].toSorted()) {
    const lowered = candidate.toLowerCase();
    const contained =
      Math.min(lowered.length, needle.length) >= 3 &&
      (lowered.includes(needle) || needle.includes(lowered));
    const distance = contained ? 0 : editDistance(needle, lowered);
    if (!contained && distance > maxDistance(needle)) continue;
    if (best === undefined || distance < best.distance) best = { name: candidate, distance };
  }
  return best?.name;
}
