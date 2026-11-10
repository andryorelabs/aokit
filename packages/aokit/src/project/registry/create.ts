import { relative, resolve as resolvePath } from "node:path";
import { AokitError } from "../../cli/envelope.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import type { PipelineModule } from "../../pipeline/index.ts";
import { formatRegistrySource, type ModuleVersion, type Registry } from "../../registry/index.ts";
import {
  clash,
  type LoadProjectRegistriesOptions,
  type ProjectRegistries,
  type RegistryAdapters,
  requiredRegistry,
} from "./context.ts";
import { openProjectRegistries } from "./project-registries.ts";
import { openShadcnAddresses } from "./shadcn-addresses.ts";

/** Wraps one read Module version as an Engine Module that reads its files from it. */
export function toPipelineModule(version: ModuleVersion, registry?: string): PipelineModule {
  return {
    manifest: version.manifest,
    integrity: version.integrity,
    ...(registry === undefined ? {} : { registry }),
    readFile(from) {
      const content = version.files.get(from);
      if (content === undefined) {
        throw new AokitError(
          "INTERNAL",
          `Module ${version.name} has no file ${from}`,
          "report the issue",
        );
      }
      return content;
    },
  };
}

/** Reads the newest selectable version of every Module a Registry publishes. */
async function newestModules(registry: Registry, key?: string): Promise<PipelineModule[]> {
  const names = Object.keys(registry.index.modules).toSorted();
  const loaded = await Promise.all(
    names.flatMap((name) => {
      const newest = registry.selectableVersions(name).at(-1);
      return newest === undefined ? [] : [registry.version(name, newest)];
    }),
  );
  return loaded.map((version) => toPipelineModule(version, key));
}

/** A Registry opened for `create`, with every Module wrapped for the Engine. */
interface LoadedRegistry {
  readonly registry: Registry;
  /** The source the Lockfile records: `bundled`, a path relative to the Project, a URL or a Pin. */
  readonly source: string;
  readonly minCliVersion: string;
  /** Whether the Lockfile records the Registry as trusted. */
  readonly trusted: boolean;
  readonly available: readonly PipelineModule[];
}

/** Inputs of {@link loadCreateRegistries} besides the flag, the request and the CLI version. */
export interface LoadRegistryOptions {
  /** The new Project's directory; a local Registry path is recorded relative to it. */
  readonly projectDir?: string;
  readonly trustFlags?: readonly string[];
  readonly interactive?: boolean;
  readonly adapters?: RegistryAdapters | undefined;
}

/** The Release every shadcn Registry reports. */
const shadcnRelease = "shadcn";

/** What {@link loadCreateRegistries} opened for a new Project. */
export interface CreateRegistries {
  /** The Registry the native Modules come from: the `--registry` one, else the bundled one. */
  readonly native: LoadedRegistry & { readonly key: string };
  /** Every Registry of the run by key, as the Lockfile would record it. */
  readonly entries: Lockfile["registries"];
  /** Every opened Registry of the run by key. */
  readonly registries: ReadonlyMap<string, Registry>;
  /** The requested entries as Module names: an item URL or `owner/repo/item#ref` becomes `@ns/item`. */
  readonly names: readonly string[];
  /** The Adapted Modules the requested ones pull in through `registryDependencies`, unrequested. */
  readonly pulledIn: readonly string[];
  /** The native Modules and the Adapted Modules the request and their dependencies need. */
  readonly available: readonly PipelineModule[];
}

/**
 * Opens the Registries of a new Project: the `--registry` one, or the bundled one, for the native
 * Modules, and, through {@link openShadcnAddresses}, every shadcn Registry a requested address or
 * its `registryDependencies` name. A `--registry` that is a shadcn Registry is added beside the
 * bundled one, which still serves the native Modules. Every Registry goes through the trust gate on
 * its own.
 */
export async function loadCreateRegistries(
  registryFlag: string | undefined,
  requested: readonly string[],
  cliVersion: string,
  options: LoadRegistryOptions = {},
): Promise<CreateRegistries> {
  const openOptions = {
    trustFlags: options.trustFlags ?? [],
    interactive: options.interactive ?? false,
    projectDir: process.cwd(),
    cliVersion,
    adapters: options.adapters,
  };
  const flaggedSet = await openProjectRegistries(undefined, {
    ...openOptions,
    registryFlag: registryFlag ?? "bundled",
  });
  const flaggedKey = flaggedSet.flagged ?? "";
  const flagged = requiredRegistry(flaggedSet.registries, flaggedKey);
  const set =
    flagged.release === shadcnRelease
      ? await withNativeRegistry(flaggedSet, flaggedKey, openOptions)
      : { ...flaggedSet, native: flaggedKey };
  const addressed = await openShadcnAddresses(set, { registries: {} }, requested, openOptions);
  const registry = requiredRegistry(addressed.set.registries, set.native);
  const source =
    registry.source.kind === "local"
      ? relative(resolvePath(options.projectDir ?? "."), registry.source.path) || "."
      : formatRegistrySource(registry.source);
  const nativeEntry = addressed.set.entries[set.native];
  const entries = {
    ...addressed.set.entries,
    ...(nativeEntry === undefined ? {} : { [set.native]: { ...nativeEntry, source } }),
  };
  const adapted = addressed.modules.map(({ key, version }) => toPipelineModule(version, key));
  const adaptedNames = new Set(adapted.map((module) => module.manifest.name));
  const nativeModules = (await newestModules(registry, set.native)).filter(
    (module) => !adaptedNames.has(module.manifest.name),
  );
  return {
    native: {
      key: set.native,
      registry,
      source,
      minCliVersion: registry.index.minCliVersion,
      trusted: nativeEntry?.trusted === true,
      available: nativeModules,
    },
    entries,
    registries: addressed.set.registries,
    names: addressed.names,
    pulledIn: [...adaptedNames].filter((name) => !addressed.names.includes(name)),
    available: [...nativeModules, ...adapted],
  };
}

/** `set` with the bundled Registry opened beside its shadcn `--registry` one, as `native`. */
async function withNativeRegistry(
  set: ProjectRegistries,
  flaggedKey: string,
  options: LoadProjectRegistriesOptions,
): Promise<ProjectRegistries & { readonly native: string }> {
  const bundled = await openProjectRegistries(undefined, { ...options, registryFlag: "bundled" });
  const native = bundled.flagged ?? "";
  const nativeRegistry = requiredRegistry(bundled.registries, native);
  const rival = set.registries.get(native);
  if (rival !== undefined) {
    throw clash(
      native,
      formatRegistrySource(nativeRegistry.source),
      formatRegistrySource(rival.source),
    );
  }
  return {
    registries: new Map([...bundled.registries, ...set.registries]),
    lockedRegistries: new Map(),
    flagged: flaggedKey,
    entries: { ...bundled.entries, ...set.entries },
    movedPins: [],
    decisions: [...bundled.decisions, ...set.decisions],
    native,
  };
}
