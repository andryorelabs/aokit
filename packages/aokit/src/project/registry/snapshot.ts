import { AokitError } from "../../cli/envelope.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import {
  type LocalRegistry,
  type ModuleVersion,
  type Registry,
  RegistryError,
} from "../../registry/index.ts";
import type { ReleaseCatalog } from "../../registry/schema.ts";
import { toAokitError } from "../errors.ts";
import { type RegistryAdapters, requiredRegistry } from "./context.ts";
import { keptIndexRegistries } from "./kept-index.ts";
import { loadProjectRegistries } from "./project-registries.ts";

function isFirstParty(registry: Registry): boolean {
  return registry.source.kind === "bundled" || registry.source.kind === "local";
}

/** Inputs of {@link openProjectRegistry}. */
export interface OpenProjectRegistryOptions {
  /** The Project directory relative sources resolve against. */
  readonly projectDir: string;
  /** Version of the running CLI. */
  readonly cliVersion: string;
  /** Overrides the shipped Registry for the `"bundled"` source. */
  readonly bundledRegistryPath?: string | undefined;
  /** The Lockfile Registry to open; the one the locked Modules come from when absent. */
  readonly registry?: string | undefined;
  readonly trustFlags?: readonly string[];
  readonly interactive?: boolean;
  readonly adapters?: RegistryAdapters | undefined;
  /**
   * Also read the newest selectable version of each locked Module of a remote Registry, which
   * `recopy` renders when a locked version is gone. Off by default, so a broken newer version never
   * fails a command that only needs the pinned ones.
   */
  readonly includeNewest?: boolean;
}

/** The name of the Lockfile Registry the locked Modules come from. */
export function primaryRegistryName(lockfile: Lockfile): string {
  const names = Object.keys(lockfile.modules).toSorted();
  const first = names.find((name) => !name.startsWith("@")) ?? names[0];
  return lockfile.modules[first ?? ""]?.registry ?? Object.keys(lockfile.registries)[0] ?? "";
}

/** What {@link snapshotRegistry} reads ahead so the snapshot can answer synchronously. */
export interface SnapshotScope {
  /** Every published version and Catalog, which is what a first-party Registry gets. */
  readonly everything?: boolean;
  /** Module versions to read; ones the index does not publish are skipped. */
  readonly versions?: readonly (readonly [string, string])[];
  /** Releases whose Catalog to read besides the current one. */
  readonly releases?: readonly string[];
}

type SnapshotModule = NonNullable<ReturnType<LocalRegistry["version"]>>;

function toSnapshotModule(version: ModuleVersion): SnapshotModule {
  return {
    manifest: version.manifest,
    files: new Map(version.files),
    integrity: version.integrity,
    renames: version.renames,
    migrationScript: (script) => version.migrationScript(script),
  };
}

/**
 * Reads what `scope` names from a lazy Registry and answers the synchronous {@link LocalRegistry}
 * interface from it. A version or Catalog outside the scope reads as absent; `modules` holds the
 * newest selectable version of each Module when it was read.
 */
export async function snapshotRegistry(
  registry: Registry,
  key: string,
  scope: SnapshotScope,
): Promise<LocalRegistry> {
  const published = (name: string, version: string): boolean =>
    registry.versions(name).includes(version);
  const wanted = scope.everything
    ? Object.keys(registry.index.modules).flatMap((name) =>
        registry.versions(name).map((version) => [name, version] as const),
      )
    : (scope.versions ?? []).filter(([name, version]) => published(name, version));
  const releases = scope.everything ? registry.releases() : (scope.releases ?? []);
  const [loaded, catalogs] = await Promise.all([
    Promise.all(wanted.map(([name, version]) => registry.version(name, version))),
    Promise.all(releases.map((release) => registry.catalog(release))),
  ]);
  const byVersion = new Map(
    loaded.map((version) => [`${version.name}@${version.version}`, toSnapshotModule(version)]),
  );
  const catalogByRelease = new Map<string, ReleaseCatalog>(
    keptIndexRegistries.has(registry) ? [] : [[registry.release, registry.currentCatalog]],
  );
  for (const [position, release] of releases.entries()) {
    const catalog = catalogs[position];
    if (catalog !== undefined) catalogByRelease.set(release, catalog);
  }
  const modules = new Map<string, SnapshotModule>();
  for (const name of Object.keys(registry.index.modules).toSorted()) {
    const newest = registry.selectableVersions(name).at(-1);
    const found = newest === undefined ? undefined : byVersion.get(`${name}@${newest}`);
    if (found !== undefined) modules.set(name, found);
  }
  return {
    name: key,
    release: registry.release,
    currentCatalog: registry.currentCatalog,
    modules,
    releases: () => registry.releases(),
    catalog: (release) => catalogByRelease.get(release),
    version: (name, version) => byVersion.get(`${name}@${version}`),
    versions: (name) => registry.versions(name),
    selectableVersions: (name) => registry.selectableVersions(name),
  };
}

/**
 * The Module versions and Release a Lockfile pins in one of its Registries and, with
 * `includeNewest`, the newest selectable version of each locked Module. A Registry read from its
 * kept offline index only gets the pinned ones, the only ones it serves.
 */
function lockedScope(
  lockfile: Lockfile,
  key: string,
  registry: Registry,
  includeNewest: boolean,
): SnapshotScope {
  const release = lockfile.registries[key]?.release;
  const locked = Object.entries(lockfile.modules)
    .filter(([, entry]) => entry.registry === key)
    .map(([name, entry]) => [name, entry.version] as const);
  const newest =
    !includeNewest || keptIndexRegistries.has(registry)
      ? []
      : locked.flatMap(([name, version]) => {
          const latest = registry.selectableVersions(name).at(-1);
          return latest === undefined || latest === version ? [] : [[name, latest] as const];
        });
  return {
    versions: [...locked, ...newest],
    releases: release === undefined ? [] : [release],
  };
}

/**
 * Opens a Registry the Lockfile lists through {@link loadProjectRegistries} (client, cache and
 * trust gate) and returns a synchronous snapshot of it. A first-party Registry is read whole; a
 * remote one only for the Module versions and Release the Lockfile pins (plus the newest selectable
 * version of each locked Module with `includeNewest`), so a warm cache serves it offline. An
 * untrusted Registry fails as a coded `REGISTRY_UNTRUSTED` command error, so no
 * caller reports it as a mere Registry problem.
 */
export async function openProjectRegistry(
  lockfile: Lockfile,
  options: OpenProjectRegistryOptions,
): Promise<LocalRegistry> {
  const key = options.registry ?? primaryRegistryName(lockfile);
  const entry = lockfile.registries[key];
  if (entry === undefined) {
    throw new AokitError(
      "INVALID_INPUT",
      "aokit.lock.json lists no Registry.",
      "Restore aokit.lock.json from version control.",
    );
  }
  let registries: Map<string, Registry>;
  try {
    registries = await loadProjectRegistries(
      { registries: { [key]: entry }, modules: lockfile.modules },
      {
        trustFlags: options.trustFlags ?? [],
        interactive: options.interactive ?? false,
        projectDir: options.projectDir,
        cliVersion: options.cliVersion,
        bundledRegistryPath: options.bundledRegistryPath,
        adapters: options.adapters,
      },
    );
  } catch (thrown) {
    if (thrown instanceof RegistryError && thrown.code === "REGISTRY_UNTRUSTED") {
      throw toAokitError(thrown);
    }
    throw thrown;
  }
  const registry = requiredRegistry(registries, key);
  return snapshotRegistry(
    registry,
    key,
    isFirstParty(registry)
      ? { everything: true }
      : lockedScope(lockfile, key, registry, options.includeNewest === true),
  );
}
