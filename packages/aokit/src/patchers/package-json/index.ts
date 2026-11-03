const SORTED_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "scripts",
] as const;

type PackageSection = Record<string, string>;

/** The subset of `package.json` fields a Module may contribute. */
export interface PackageJsonPatch {
  [key: string]: unknown;
  dependencies?: PackageSection;
  devDependencies?: PackageSection;
  peerDependencies?: PackageSection;
  optionalDependencies?: PackageSection;
  scripts?: PackageSection;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function mergeSection(existing: unknown, incoming: Record<string, unknown>) {
  const merged = isRecord(existing) ? { ...existing } : {};
  for (const [name, value] of Object.entries(incoming)) {
    if (!(name in merged)) merged[name] = value;
  }
  return sortedRecord(merged);
}

/**
 * Structurally merges a patch into `package.json` text.
 * Dependency and script sections merge by name with sorted keys and never replace
 * an entry the user already has; other top-level keys are added only when absent.
 */
export function mergePackageJson(text: string, patch: PackageJsonPatch): string {
  const parsed: unknown = text.trim() === "" ? {} : JSON.parse(text);
  const manifest: Record<string, unknown> = isRecord(parsed) ? parsed : {};
  for (const [key, value] of Object.entries(patch)) {
    if ((SORTED_SECTIONS as readonly string[]).includes(key) && isRecord(value)) {
      manifest[key] = mergeSection(manifest[key], value);
    } else if (!(key in manifest)) {
      manifest[key] = value;
    }
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
