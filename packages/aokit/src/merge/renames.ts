/**
 * Composes Renames manifests listed in version order into one map: `a→b` then `b→c` gives `a→c`.
 * A path that ends where it started drops out.
 */
export function composeRenames(
  manifests: ReadonlyArray<Readonly<Record<string, string>>>,
): Map<string, string> {
  const composed = new Map<string, string>();
  for (const manifest of manifests) {
    for (const [from, to] of Object.entries(manifest)) {
      const origins = [...composed]
        .filter(([, current]) => current === from)
        .map(([origin]) => origin);
      for (const origin of origins) composed.delete(origin);
      for (const origin of origins.length === 0 ? [from] : origins) {
        if (origin !== to) composed.set(origin, to);
      }
    }
  }
  return composed;
}
