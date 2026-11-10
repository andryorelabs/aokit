import { legacyManifestDescription } from "@aokit/module";
import { z } from "zod";
import { loadCreateRegistries } from "../../project/registry/create.ts";
import type { Registry } from "../../registry/index.ts";
import { defineCommand } from "../command.ts";
import { aokitMeta } from "../meta.ts";

/** The input of `aokit list`: which Registry to read and which Registries to trust. */
const listInput = z.object({
  registry: z
    .string()
    .optional()
    .describe(
      "Registry source: a local directory, an https:// URL or github:owner/repo#ref; the bundled Registry by default",
    )
    .register(aokitMeta, {
      flag: "registry",
      examples: ["--registry ./registry", "--registry github:acme/mods#v1"],
    }),
  trust: z
    .array(z.string())
    .default([])
    .describe("Trust a Registry by name or source; repeatable. `--yes` never grants trust")
    .register(aokitMeta, { flag: "trust", examples: ["--trust github:acme/mods"] }),
});

const moduleListingSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  provides: z.array(z.string()),
});

/** One Module of a Registry: its latest version, description and the Capabilities it provides. */
export type ModuleListing = z.infer<typeof moduleListingSchema>;

const capabilityEntrySchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
});

/** The output of `aokit list` and of the MCP `list` tool. */
const listOutput = z.object({
  modules: z.array(moduleListingSchema),
  byCapability: z.record(z.string(), z.array(capabilityEntrySchema)),
});

const uncategorized = "uncategorized";

/** Groups listings under each Capability they provide, in name order; a Module may appear in several groups. */
export function groupByCapability(
  modules: readonly ModuleListing[],
): Record<string, z.infer<typeof capabilityEntrySchema>[]> {
  const groups: Record<string, z.infer<typeof capabilityEntrySchema>[]> = {};
  for (const { name, version, description, provides } of modules) {
    for (const capability of provides.length === 0 ? [uncategorized] : provides) {
      (groups[capability] ??= []).push({ name, version, description });
    }
  }
  return Object.fromEntries(
    Object.entries(groups).toSorted(([left], [right]) => (left < right ? -1 : 1)),
  );
}

/** Reads every Module of `registry` at its latest version, sorted by name. */
export async function listModules(registry: Registry): Promise<ModuleListing[]> {
  const entries = Object.entries(registry.index.modules).toSorted(([left], [right]) =>
    left < right ? -1 : 1,
  );
  return Promise.all(
    entries.map(async ([name, entry]) => {
      const { manifest } = await registry.version(name, entry.latest);
      return {
        name,
        version: entry.latest,
        description: manifest.description === legacyManifestDescription ? "" : manifest.description,
        provides: manifest.provides.map((provided) => provided.capability),
      };
    }),
  );
}

export const listCommand = defineCommand({
  name: "list",
  description: "List the Modules of a Registry, grouped by the Capability they provide",
  input: listInput,
  output: listOutput,
  async run(context, input) {
    const opened = await loadCreateRegistries(input.registry, [], context.version, {
      trustFlags: input.trust,
      interactive: false,
      adapters: { env: context.env },
    });
    const modules = await listModules(opened.native.registry);
    return { modules, byCapability: groupByCapability(modules) };
  },
});
