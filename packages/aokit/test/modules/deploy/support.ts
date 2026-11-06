import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogSchema, parseManifest } from "@aokit/module";
import type { EngineContext, EngineModule } from "../../../src/engine/index.ts";
import { type PipelineInput, buildProject } from "../../../src/pipeline/index.ts";

type BuildResult = Awaited<ReturnType<typeof buildProject>>;
type BuiltProject = Extract<BuildResult, { ok: true }>;

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const sourceRoot = join(repositoryRoot, "registry-src");

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };
const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(sourceRoot, "catalog", "2026.11.0.json"), "utf8")),
);

/** Loads a curated Module from `registry-src/` as an Engine Module. */
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

/** Builds a selection of curated Modules on an empty base. */
export async function buildSelection(
  selection: readonly string[],
  overrides: Partial<Omit<PipelineInput, "base" | "previous">> = {},
): Promise<BuildResult> {
  const available = await Promise.all(
    ["hono", "docker", "coolify"].map((name) => loadModule(name)),
  );
  return buildProject({
    selection,
    available,
    answers: {},
    layout: "single",
    catalog,
    context,
    registry: {
      name: "official",
      source: "registry",
      release: "2026.11.0",
      minCliVersion: "0.1.0",
    },
    ...overrides,
  });
}

/** Unwraps a successful build or throws with the Resolver error. */
export function expectBuilt(result: BuildResult): BuiltProject {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result;
}
