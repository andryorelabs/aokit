import { loadUserConfig } from "../../config/user-config.ts";
import { createRegistryCache } from "../cache.ts";
import { RegistryError } from "../errors.ts";
import type { Integrity } from "../integrity.ts";
import { urlTransport } from "../remote.ts";
import type { ReleaseCatalog } from "../schema.ts";
import type { AdaptedModule } from "../shadcn/adapt.ts";
import { formatRegistrySource } from "../source.ts";
import {
  byCodepoint,
  type ModuleVersion,
  type OpenRegistryContext,
  type Registry,
  verifyIntegrity,
} from "./common.ts";
import {
  adaptedModuleVersion,
  asIntegrity,
  cachedContent,
  declareNamespace,
  hostScope,
  type ItemLocation,
  type ItemRead,
  itemChangedFix,
  namespaceEnvironment,
  namespaceItemLocation,
  readCachedAdapted,
  readItem,
  readShadcnIndex,
  scopeOf,
  scopePattern,
  type ShadcnSource,
  shadcnRelease,
  splitModuleKey,
  syntheticIndex,
} from "./shadcn-items.ts";

/** The opened side of a shadcn source: its name, reported source, items and how to fetch one. */
interface ShadcnOrigin {
  readonly name: string;
  readonly source: ShadcnSource;
  readonly listed: readonly string[];
  readonly indexText: string;
  readonly locate: (item: string) => ItemLocation;
}

async function openShadcnOrigin(
  source: ShadcnSource,
  context: OpenRegistryContext,
  preReadIndex: string | undefined,
): Promise<ShadcnOrigin> {
  const fetchImpl = context.fetch ?? fetch;
  if (source.namespace === undefined) {
    const transport = urlTransport(source.url, fetchImpl);
    const read = await readShadcnIndex(transport, preReadIndex);
    const declared = read?.index.name;
    const pinnedScope = [...(context.pinned?.keys() ?? [])]
      .map(scopeOf)
      .find((scope) => scope !== undefined);
    return {
      name:
        declared !== undefined && scopePattern.test(declared)
          ? declared
          : (pinnedScope ?? hostScope(source.url)),
      source: { kind: "shadcn", url: source.url },
      listed: read?.index.items ?? [],
      indexText: read?.text ?? "",
      locate: (item) => ({ transport, path: `${item}.json` }),
    };
  }
  const { namespace } = source;
  const userConfig = context.userConfig ?? (await loadUserConfig(context.env ?? process.env));
  const declaration = declareNamespace(namespace, source.url, userConfig);
  const env = await namespaceEnvironment(context);
  return {
    name: namespace,
    source: { kind: "shadcn", namespace, url: declaration.template },
    listed: [],
    indexText: declaration.template,
    locate: (item) => namespaceItemLocation(namespace, declaration, item, env, fetchImpl),
  };
}

function itemChanged(
  registryName: string,
  module: string,
  recorded: Integrity,
  current: AdaptedModule | undefined,
): RegistryError {
  return new RegistryError(
    "REGISTRY_ITEM_CHANGED",
    `Registry "${registryName}" no longer serves ${module}, and the integrity cache does not hold its recorded integrity ${recorded}.`,
    itemChangedFix,
    {
      registry: registryName,
      module,
      expected: recorded,
      ...(current === undefined ? {} : { actual: current.integrity }),
    },
  );
}

/**
 * Opens a shadcn Registry: a base URL whose `registry.json` lists its items, or a Namespace whose
 * URL template and headers come from the user config. Every item `registry.json` lists (or only
 * those of `items`) and every item the Lockfile pins is read and adapted with `adaptShadcnItem` at
 * open, and stored in the integrity cache, which is mandatory here. `version` serves the adapted
 * item when it still has the requested version and recorded integrity, else the verified cache
 * entry of the recorded integrity, and fails with `REGISTRY_ITEM_CHANGED` when neither holds it.
 */
export async function openShadcnRegistry(
  source: ShadcnSource,
  context: OpenRegistryContext,
  preReadIndex?: string,
): Promise<Registry> {
  const cache = context.cache ?? createRegistryCache();
  const pinned = context.pinned ?? new Map<string, string>();
  const origin = await openShadcnOrigin(source, context, preReadIndex);
  const registryName = origin.name;
  const modulePrefix = `@${registryName.startsWith("@") ? registryName.slice(1) : registryName}/`;
  const itemOf = (name: string): string | undefined =>
    name.startsWith(modulePrefix) ? name.slice(modulePrefix.length) : undefined;
  const pinnedVersions = new Map<string, string[]>();
  for (const key of [...pinned.keys()].toSorted(byCodepoint)) {
    const split = splitModuleKey(key);
    if (split !== undefined && itemOf(split.name) !== undefined) {
      pinnedVersions.set(split.name, [...(pinnedVersions.get(split.name) ?? []), split.version]);
    }
  }
  const requested = new Set(context.items ?? []);
  const names = [
    ...new Set([
      ...(context.items === undefined ? origin.listed : requested),
      ...[...pinnedVersions.keys()].flatMap((name) => itemOf(name) ?? []),
    ]),
  ].toSorted(byCodepoint);
  const outcomes = await Promise.all(
    names.map(async (item): Promise<ItemRead> => {
      try {
        return await readItem(
          origin.locate(item),
          item,
          registryName,
          context.sourceSha,
          formatRegistrySource(origin.source),
        );
      } catch (error) {
        return { kind: "failed", error };
      }
    }),
  );
  const reads = new Map<string, ItemRead>();
  const served = new Map<string, AdaptedModule>();
  for (const [position, item] of names.entries()) {
    const outcome: ItemRead = outcomes[position] ?? { kind: "missing" };
    if (outcome.kind === "failed" && requested.has(item)) {
      throw outcome.error;
    }
    reads.set(item, outcome);
    if (outcome.kind === "served") {
      served.set(`${modulePrefix}${item}`, outcome.module);
    }
  }
  await Promise.all(
    [...served.values()].map((module) => cache.put(module.integrity, cachedContent(module))),
  );
  const currentCatalog: ReleaseCatalog = {
    release: shadcnRelease,
    dependencies: {},
    pinGroups: {},
    modules: Object.fromEntries([...served].map(([name, module]) => [name, module.version])),
  };
  const selectableVersions = (name: string): string[] => {
    const module = served.get(name);
    return module === undefined ? [] : [module.version];
  };
  const versions = (name: string): string[] =>
    [...new Set([...selectableVersions(name), ...(pinnedVersions.get(name) ?? [])])].toSorted(
      (left, right) => Bun.semver.order(left, right),
    );
  const load = async (name: string, version: string): Promise<ModuleVersion> => {
    const module = `${name}@${version}`;
    const item = itemOf(name);
    const read = item === undefined ? undefined : reads.get(item);
    const current = read?.kind === "served" ? read.module : undefined;
    const recorded = asIntegrity(pinned.get(module));
    if (
      current?.version === version &&
      (recorded === undefined || current.integrity === recorded)
    ) {
      return adaptedModuleVersion(
        name,
        version,
        current.manifest,
        current.files,
        current.integrity,
        registryName,
      );
    }
    const cached =
      recorded === undefined
        ? undefined
        : await readCachedAdapted(cache, recorded, name, version, registryName);
    if (cached !== undefined) {
      return cached;
    }
    if (current?.version === version && recorded !== undefined) {
      verifyIntegrity(current.integrity, recorded, `Adapted Module ${module}`, {
        registry: registryName,
        module,
      });
    }
    if (read?.kind === "failed") {
      throw read.error;
    }
    if (recorded !== undefined) {
      throw itemChanged(registryName, module, recorded, current);
    }
    throw new RegistryError(
      "REGISTRY_MODULE_NOT_FOUND",
      `Registry "${registryName}" does not serve ${module}.`,
      `Pick the version it serves: ${versions(name).join(", ") || "(none)"}.`,
      { registry: registryName, module },
    );
  };
  const loaded = new Map<string, Promise<ModuleVersion>>();
  return {
    name: registryName,
    source: origin.source,
    index: syntheticIndex(registryName, origin.indexText, served),
    release: shadcnRelease,
    currentCatalog,
    releases: () => [shadcnRelease],
    catalog: (release) => Promise.resolve(release === shadcnRelease ? currentCatalog : undefined),
    versions,
    selectableVersions,
    version(name, version) {
      const key = `${name}@${version}`;
      const known = loaded.get(key);
      if (known !== undefined) {
        return known;
      }
      const loading = load(name, version);
      loaded.set(key, loading);
      loading.catch(() => loaded.delete(key));
      return loading;
    },
  };
}
