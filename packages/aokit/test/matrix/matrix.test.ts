import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { cliVersion } from "../../src/cli/version.ts";
import { type EngineModule, Vfs } from "../../src/engine/index.ts";
import type { LayoutName } from "../../src/engine/layout.ts";
import { formatterForSelection } from "../../src/format/index.ts";
import { buildProject } from "../../src/pipeline/index.ts";
import { type LocalRegistry, readLocalRegistry } from "../../src/registry/index.ts";
import { type Selection, feasiblePairs, pairwiseCover, validSelections } from "./pairwise.ts";

const registryPath = join(import.meta.dir, "..", "..", "..", "..", "registry");
const layouts: readonly LayoutName[] = ["single", "monorepo"];

function engineModules(registry: LocalRegistry): EngineModule[] {
  return [...registry.modules.entries()].map(([name, entry]) => ({
    manifest: entry.manifest,
    readFile(from) {
      const content = entry.files.get(from);
      if (content === undefined) {
        throw new Error(`Module ${name} has no file ${from}`);
      }
      return content;
    },
  }));
}

async function buildDigest(
  registry: LocalRegistry,
  available: readonly EngineModule[],
  selection: Selection,
  layout: LayoutName,
): Promise<{ readonly planHash: string; readonly digest: string }> {
  const manifests = available
    .map((module) => module.manifest)
    .filter((manifest) => selection.includes(manifest.name));
  const formatter = formatterForSelection({ catalog: registry.catalog, modules: manifests });
  const built = await buildProject({
    selection,
    available,
    answers: {},
    layout,
    catalog: registry.catalog,
    context: { now: new Date(0), random: () => 0.5, env: {} },
    registry: {
      name: registry.name,
      source: "bundled",
      release: registry.release,
      minCliVersion: "0.1.0",
    },
    base: Vfs.empty(),
    ...(formatter === undefined ? {} : { formatter }),
  });
  if (!built.ok) {
    throw new Error(`${layout} ${selection.join(",")}: ${built.error.message}`);
  }
  const lockfileDigest = createHash("sha256").update(built.lockfileText).digest("hex");
  return {
    planHash: built.plan.hash,
    digest: `plan=${built.plan.hash} lockfile=${lockfileDigest}`,
  };
}

const registry = await readLocalRegistry(registryPath, { cliVersion });
const available = engineModules(registry);
const manifests = available.map((module) => module.manifest);
const names = manifests.map((manifest) => manifest.name);
const selections = validSelections(manifests);
const cover = pairwiseCover(names, selections);

describe("capability-derived matrix", () => {
  test("enumerates the curated Modules and the selections the Resolver accepts", () => {
    expect(names.toSorted()).toEqual([
      "coolify",
      "docker",
      "hono",
      "knip",
      "oxc",
      "tailwind4",
      "vite-react",
    ]);
    expect(selections.length).toBeGreaterThan(0);
    expect(selections).not.toContainEqual(["coolify"]);
    expect(selections).toContainEqual(["coolify", "docker"]);
  });

  test("the covering set realizes every feasible pair of Modules", () => {
    expect(feasiblePairs(names, cover)).toEqual(feasiblePairs(names, selections));
    expect(cover.length).toBeLessThan(selections.length);
    for (const selection of cover) {
      expect(selections).toContainEqual(selection);
    }
  });

  test(
    "builds every combination twice with equal Plan hashes on both Layouts",
    async () => {
      const digests: Record<string, string> = {};
      for (const layout of layouts) {
        for (const selection of cover) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- fixed, ordered output
          const first = await buildDigest(registry, available, selection, layout);
          // oxlint-disable-next-line eslint/no-await-in-loop -- fixed, ordered output
          const second = await buildDigest(registry, available, selection, layout);
          expect(second.planHash).toBe(first.planHash);
          expect(second.digest).toBe(first.digest);
          digests[`${layout} ${selection.join(",")}`] = first.digest;
        }
      }
      expect(digests).toMatchSnapshot();
      const target = process.env["AOKIT_MATRIX_DIGEST_FILE"];
      if (target !== undefined && target !== "") {
        const lines = Object.entries(digests).map(([key, digest]) => `${key} ${digest}`);
        await writeFile(target, `${lines.join("\n")}\n`);
      }
    },
    { timeout: 120_000 },
  );
});
