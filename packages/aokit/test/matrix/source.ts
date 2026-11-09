import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type ModuleManifest, parseManifest } from "@aokit/module";
import { type CuratedSelection, readCuratedSelections } from "../../../../tools/real-build/plan.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "registry-src");

/** The manifest of every Module in `registry-src/`, in name order. */
export async function loadSourceManifests(): Promise<ModuleManifest[]> {
  const names = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(sourceRoot, entry.name, "module.ts")))
    .map((entry) => entry.name)
    .toSorted();
  return Promise.all(
    names.map(async (name) => {
      const loaded: unknown = await import(join(sourceRoot, name, "module.ts"));
      if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
        throw new Error(`Module ${name} has no default export`);
      }
      return parseManifest(loaded.default);
    }),
  );
}

/** The curated Module selections of `tools/real-build/curated/*.json`, read on every call. */
export function loadCuratedSets(): CuratedSelection[] {
  return readCuratedSelections();
}

/** The curated sets built on both Layouts, which a Layout migration can cross in both directions. */
export function loadMigratableSets(): CuratedSelection[] {
  return loadCuratedSets().filter(
    (set) =>
      set.layouts === undefined ||
      (set.layouts.includes("single") && set.layouts.includes("monorepo")),
  );
}
