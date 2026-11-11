/** One live setting that differs from the files. */
export type Drift = { setting: string; expected: unknown; live: unknown };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinKey(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function compareAt(path: string, expected: unknown, live: unknown): Drift[] {
  if (isRecord(expected) && isRecord(live)) {
    return Object.entries(expected).flatMap(([key, value]) =>
      compareAt(joinKey(path, key), value, live[key]),
    );
  }
  if (Array.isArray(expected) && Array.isArray(live) && expected.length === live.length) {
    return expected.flatMap((value: unknown, index) =>
      compareAt(`${path}[${index}]`, value, live[index]),
    );
  }
  const isComposite = isRecord(expected) || Array.isArray(expected);
  if (!isComposite && Object.is(expected, live)) return [];
  return [{ setting: path === "" ? "(root)" : path, expected, live }];
}

/**
 * Returns one entry per setting in `expected` whose live value differs. A mapping is compared key
 * by key and only for the keys `expected` names, since the GitHub API returns many fields the
 * files do not set. A list is compared element by element, and a list of another length is drift
 * as a whole.
 */
export function compareSettings(expected: unknown, live: unknown): Drift[] {
  return compareAt("", expected, live);
}
