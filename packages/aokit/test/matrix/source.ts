import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type ModuleManifest, parseManifest } from "@aokit/module";

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
