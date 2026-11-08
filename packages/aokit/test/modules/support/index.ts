import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Catalog, composeDraftCatalog, parseManifest } from "@aokit/module";
import type { EngineContext, EngineModule } from "../../../src/engine/index.ts";
import type { LayoutName } from "../../../src/engine/layout.ts";
import { buildProject } from "../../../src/pipeline/index.ts";

type BuildResult = Awaited<ReturnType<typeof buildProject>>;

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "..", "registry-src");

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

/**
 * The draft Catalog Module tests resolve dependencies from: the latest Release Catalog plus the
 * `catalog.json` fragment of every Pending Module in `registry-src/`.
 */
export function draftCatalog(): Catalog {
  return composeDraftCatalog(sourceRoot);
}

async function loadModule(name: string): Promise<EngineModule> {
  const loaded: unknown = await import(join(sourceRoot, name, "module.ts"));
  if (typeof loaded !== "object" || loaded === null || !("default" in loaded)) {
    throw new Error(`Module ${name} has no default export`);
  }
  return {
    manifest: parseManifest(loaded.default),
    readFile: (from) => readFileSync(join(sourceRoot, name, from), "utf8"),
  };
}

async function loadAvailableModules(): Promise<EngineModule[]> {
  const names = readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(sourceRoot, entry.name, "module.ts")))
    .map((entry) => entry.name)
    .toSorted();
  return Promise.all(names.map((name) => loadModule(name)));
}

/**
 * Builds a selection of `registry-src/` Modules on an empty base with the draft Catalog, so a
 * Module test sees the dependencies its own `catalog.json` adds.
 */
export async function buildSelection(
  names: readonly string[],
  layout: LayoutName,
): Promise<BuildResult> {
  return buildProject({
    selection: names,
    available: await loadAvailableModules(),
    answers: {},
    layout,
    catalog: draftCatalog(),
    context,
    registry: {
      name: "official",
      source: "registry",
      release: draftCatalog().release ?? "0.0.0",
      minCliVersion: "0.1.0",
    },
  });
}
