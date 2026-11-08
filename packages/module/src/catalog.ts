import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The Catalog a Registry release ships: dependency name to version, plus Toolchain pin groups.
 * A pin group lists the dependency names that move together and are pinned exactly.
 * `release` names the Registry Release the Catalog belongs to.
 */
export const catalogSchema = z
  .strictObject({
    release: z.string().min(1).optional(),
    dependencies: z.record(z.string().min(1), z.string().min(1)),
    pinGroups: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
  })
  .superRefine((catalog, context) => {
    for (const [group, members] of Object.entries(catalog.pinGroups)) {
      for (const member of members) {
        if (!(member in catalog.dependencies)) {
          context.addIssue({
            code: "custom",
            path: ["pinGroups", group],
            message: `pin group "${group}" lists "${member}", which is not in dependencies`,
          });
        }
      }
    }
  });

export type Catalog = z.output<typeof catalogSchema>;
export type CatalogInput = z.input<typeof catalogSchema>;

const catalogFragmentSchema = z.strictObject({
  dependencies: z.record(z.string().min(1), z.string().min(1)),
  pinGroups: z.record(z.string().min(1), z.array(z.string().min(1))).default({}),
});

type CatalogFragment = z.output<typeof catalogFragmentSchema>;

const catalogDirectoryName = "catalog";
const catalogFragmentFileName = "catalog.json";

function compareReleases(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readLatestReleaseCatalog(registrySrcDir: string): Catalog {
  const catalogDir = join(registrySrcDir, catalogDirectoryName);
  const releases = readdirSync(catalogDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .toSorted(compareReleases);
  const latest = releases.at(-1);
  if (latest === undefined) {
    throw new Error(`composeDraftCatalog: no Release Catalog in ${catalogDir}`);
  }
  const { modules: _modules, ...catalogSource } = z
    .looseObject({ modules: z.unknown().optional() })
    .parse(readJson(join(catalogDir, `${latest}.json`)));
  return catalogSchema.parse(catalogSource);
}

function readFragments(registrySrcDir: string): { module: string; fragment: CatalogFragment }[] {
  return readdirSync(registrySrcDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== catalogDirectoryName)
    .map((entry) => entry.name)
    .toSorted()
    .filter((module) => existsSync(join(registrySrcDir, module, catalogFragmentFileName)))
    .map((module) => ({
      module,
      fragment: catalogFragmentSchema.parse(
        readJson(join(registrySrcDir, module, catalogFragmentFileName)),
      ),
    }));
}

/**
 * Composes the draft Catalog: the latest Release Catalog under `<registrySrcDir>/catalog/` plus
 * every `<module>/catalog.json` fragment of a Pending Module. Throws when a fragment redefines a
 * dependency or pin group the Release Catalog already holds, or when two fragments declare the
 * same dependency with different ranges. With no fragments it equals the latest Release Catalog.
 */
export function composeDraftCatalog(registrySrcDir: string): Catalog {
  const released = readLatestReleaseCatalog(registrySrcDir);
  const releaseLabel = released.release ?? "latest";
  const dependencies = { ...released.dependencies };
  const pinGroups = { ...released.pinGroups };
  const declaredBy = new Map<string, { module: string; range: string }>();
  for (const { module, fragment } of readFragments(registrySrcDir)) {
    for (const [name, range] of Object.entries(fragment.dependencies)) {
      if (name in released.dependencies) {
        throw new Error(
          `composeDraftCatalog: ${module}/catalog.json redefines "${name}", which the ${releaseLabel} Catalog already holds`,
        );
      }
      const previous = declaredBy.get(name);
      if (previous !== undefined && previous.range !== range) {
        throw new Error(
          `composeDraftCatalog: ${previous.module} and ${module} disagree on "${name}": ${previous.range} vs ${range}`,
        );
      }
      declaredBy.set(name, { module, range });
      dependencies[name] = range;
    }
    for (const [group, members] of Object.entries(fragment.pinGroups)) {
      if (group in released.pinGroups) {
        throw new Error(
          `composeDraftCatalog: ${module}/catalog.json redefines pin group "${group}", which the ${releaseLabel} Catalog already holds`,
        );
      }
      pinGroups[group] = [...new Set([...(pinGroups[group] ?? []), ...members])].toSorted();
    }
  }
  return catalogSchema.parse({
    ...(released.release === undefined ? {} : { release: released.release }),
    dependencies: Object.fromEntries(
      Object.entries(dependencies).toSorted(([left], [right]) => (left < right ? -1 : 1)),
    ),
    pinGroups,
  });
}
