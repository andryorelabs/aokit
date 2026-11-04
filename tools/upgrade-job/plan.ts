import { posix } from "node:path";

/** The shape of `registry/index.json` the Upgrade job reads and rewrites. */
export interface RegistryIndex {
  release: string;
  releases: Record<string, unknown>;
  modules: Record<string, { latest: string; versions: Record<string, unknown> }>;
  [field: string]: unknown;
}

/** One entry of a Lockfile's `files` map, as far as the Upgrade job needs it. */
export interface LockedFile {
  readonly mode: string;
  readonly owners: readonly string[];
}

/** A representative edit the job makes to a created Project before updating it. */
export interface Edit {
  readonly kind: "managed-text" | "managed-json" | "seed" | "user-import" | "user-note";
  /** Project-relative POSIX path the edit is written to. */
  readonly path: string;
  /** Text the edit adds; it must survive the update, at its path or at a renamed one. */
  readonly marker: string;
}

function bySemver(left: string, right: string): number {
  return Bun.semver.order(left, right);
}

function byCodepoint(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Every consecutive pair of Releases, oldest first, e.g. `[["2026.11.0", "2026.11.1"]]`. */
export function releasePairs(releases: readonly string[]): [string, string][] {
  const sorted = releases.toSorted(bySemver);
  return sorted
    .slice(1)
    .map((release, position): [string, string] => [sorted[position] ?? "", release]);
}

/** The last consecutive pair of Releases, e.g. `["2026.11.1", "2026.11.2"]` for three Releases. */
export function lastPair(releases: readonly string[]): [string, string] {
  const pair = releasePairs(releases).at(-1);
  if (pair === undefined) {
    throw new Error(`The Upgrade job needs at least two Releases, found ${releases.length}.`);
  }
  return pair;
}

/**
 * The index as it stood at `release`: later Releases are dropped, and each Module is cut back to
 * the version `catalogModules` (the built Catalog's `modules` map of `release`) maps it to.
 * Modules the Catalog does not list are dropped.
 */
export function indexAtRelease(
  index: RegistryIndex,
  release: string,
  catalogModules: Record<string, string>,
): RegistryIndex {
  const copy = structuredClone(index);
  for (const later of Object.keys(index.releases)) {
    if (bySemver(later, release) > 0) delete copy.releases[later];
  }
  copy.release = release;
  for (const [name, entry] of Object.entries(copy.modules)) {
    const pinned = catalogModules[name];
    if (pinned === undefined || entry.versions[pinned] === undefined) {
      delete copy.modules[name];
      continue;
    }
    for (const version of Object.keys(entry.versions)) {
      if (bySemver(version, pinned) > 0) delete entry.versions[version];
    }
    entry.latest = pinned;
  }
  return copy;
}

const codeExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function isTextEditable(path: string): boolean {
  const base = posix.basename(path);
  const extension = posix.extname(path);
  return (
    codeExtensions.has(extension) ||
    base.startsWith("Dockerfile") ||
    [".yaml", ".yml", ".css"].includes(extension)
  );
}

function isJsonEditable(path: string): boolean {
  const base = posix.basename(path);
  return posix.extname(path) === ".json" && base !== "package.json" && base !== "aokit.lock.json";
}

function pathsWithMode(
  files: Readonly<Record<string, LockedFile>>,
  mode: string,
  accepts: (path: string) => boolean,
): string[] {
  return Object.entries(files)
    .filter(([path, entry]) => entry.mode === mode && accepts(path))
    .map(([path]) => path)
    .toSorted(byCodepoint);
}

function appendedLine(path: string, marker: string): string {
  const extension = posix.extname(path);
  if (codeExtensions.has(extension)) return `export const ${marker} = true;\n`;
  if (extension === ".css") return `/* ${marker} */\n`;
  return `# ${marker}\n`;
}

/**
 * Chooses the representative edits for a created Project from its Lockfile: a line appended to a
 * managed text file (the routes file when present, which a Release may rename), a key added to a
 * managed JSON file (the oxlint config when present), an edited seed, and, when `vite-react` is
 * selected, a user file importing `./routes` in its `web` Target. Edits with no candidate file
 * are left out. A note appended to the root `AGENTS.md` is always planned: the file is a Region
 * file when the Release renders it and user-authored text to adopt otherwise.
 */
export function planEdits(
  files: Readonly<Record<string, LockedFile>>,
  modules: readonly string[],
): Edit[] {
  const edits: Edit[] = [];
  const managedText = pathsWithMode(files, "managed", isTextEditable);
  const textPath =
    managedText.find((path) => /(?:^|\/)src\/rout(?:es|er)\.tsx$/u.test(path)) ??
    managedText.find((path) => files[path]?.owners.length === 1);
  if (textPath !== undefined) {
    edits.push({ kind: "managed-text", path: textPath, marker: "upgradeJobManagedEdit" });
  }
  const managedJson = pathsWithMode(files, "managed", isJsonEditable);
  const jsonPath = managedJson.find((path) => path.endsWith("oxlintrc.json")) ?? managedJson[0];
  if (jsonPath !== undefined) {
    edits.push({ kind: "managed-json", path: jsonPath, marker: "upgradeJobJsonEdit" });
  }
  const seedPath = pathsWithMode(files, "seed", isTextEditable)[0];
  if (seedPath !== undefined) {
    edits.push({ kind: "seed", path: seedPath, marker: "upgradeJobSeedEdit" });
  }
  const main = modules.includes("vite-react")
    ? Object.keys(files).find(
        (path) =>
          /(?:^|\/)src\/main\.tsx$/u.test(path) && files[path]?.owners.includes("vite-react"),
      )
    : undefined;
  if (main !== undefined) {
    edits.push({
      kind: "user-import",
      path: posix.join(posix.dirname(main), "user-routes.ts"),
      marker: "upgradeJobUserRoute",
    });
  }
  edits.push({ kind: "user-note", path: "AGENTS.md", marker: "upgradeJobAgentsNote" });
  return edits;
}

/** Content of the edited file for `edit`, given the current `content` ("" for a new file). */
export function applyEdit(edit: Edit, content: string): string {
  if (edit.kind === "managed-json") return content.replace("{", `{\n  "${edit.marker}": true,`);
  if (edit.kind === "user-import") {
    return `import { ${edit.marker} } from "./routes";\n\nexport { ${edit.marker} };\n`;
  }
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${appendedLine(edit.path, edit.marker)}`;
}
