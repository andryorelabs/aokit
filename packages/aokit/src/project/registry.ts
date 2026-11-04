import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve as resolvePath } from "node:path";
import { AokitError } from "../cli/envelope.ts";
import { toAokitError } from "./errors.ts";
import type { UserConfig } from "../config/user-config.ts";
import type { PipelineModule } from "../pipeline/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { bundledRegistryPath as shippedRegistryPath } from "../registry/bundled.ts";
import { createRegistryCache } from "../registry/cache.ts";
import type { GitLsRemote } from "../registry/github.ts";
import {
  formatRegistrySource,
  type LocalRegistry,
  type ModuleVersion,
  openRegistry,
  parseRegistrySource,
  type Registry,
  type RegistryCache,
  RegistryError,
  type RegistrySource,
} from "../registry/index.ts";
import type { ReleaseCatalog } from "../registry/schema.ts";
import { ensureTrusted, type TrustDecision } from "../trust/gate.ts";
import { sourceIdentity } from "../trust/identity.ts";
import { xdgCacheDir } from "../xdg.ts";

type Environment = Readonly<Record<string, string | undefined>>;

/** Where relative and `"bundled"` Registry sources resolve from. */
export interface RegistrySourceContext {
  /** The directory a relative source resolves against. */
  readonly projectDir: string;
  /** The Registry that ships with the running CLI, used for the `"bundled"` source. */
  readonly bundledRegistryPath: string;
}

/**
 * Resolves a Registry source to a local directory: `"bundled"` is the shipped Registry, a
 * relative path or a `file:` URL is a local directory, and an `https://` URL or a `github:` source
 * throws `INVALID_INPUT`, since it has no directory; read those with {@link loadProjectRegistries}.
 */
export function resolveRegistrySource(source: string, context: RegistrySourceContext): string {
  const parsed = parseSource(source, context);
  if (parsed.kind === "bundled" || parsed.kind === "local") {
    return parsed.path;
  }
  throw new AokitError(
    "INVALID_INPUT",
    `Registry source "${source}" is remote and has no local directory.`,
    "Use a local Registry path or the bundled Registry.",
  );
}

function parseSource(source: string, context: RegistrySourceContext): RegistrySource {
  try {
    return parseRegistrySource(source, context);
  } catch (error) {
    if (error instanceof RegistryError) {
      throw new AokitError("INVALID_INPUT", error.message, error.fix);
    }
    throw error;
  }
}

/**
 * How Registries are reached and trust is asked. Every field has a real default; tests inject
 * a `fetch`, a cache directory, the `git ls-remote` and GitHub raw-base adapters, and a prompt.
 */
export interface RegistryAdapters {
  readonly fetch?: typeof fetch;
  /** The Module cache; `$XDG_CACHE_HOME/aokit/registry` of {@link env} by default. */
  readonly cache?: RegistryCache;
  readonly github?: { readonly lsRemote?: GitLsRemote; readonly rawBaseUrl?: string };
  /** Asks the trust question; a terminal prompt by default. */
  readonly prompt?: (question: string) => Promise<string>;
  /** The environment the user config and cache paths come from; `process.env` by default. */
  readonly env?: Environment;
  /** The user config allowlist; read from {@link env} when absent. */
  readonly userConfig?: UserConfig;
}

/** Inputs of {@link loadProjectRegistries}. */
export interface LoadProjectRegistriesOptions {
  /** `--registry <name|source>`: a Lockfile Registry name, or a source to open besides them. */
  readonly registryFlag?: string | undefined;
  /** Every `--trust <name|source>` value. */
  readonly trustFlags: readonly string[];
  /** Whether an untrusted Registry may be asked about. */
  readonly interactive: boolean;
  /** The Project directory relative sources resolve against; the working directory by default. */
  readonly projectDir?: string;
  /** Version of the running CLI, compared against every index `minCliVersion`. */
  readonly cliVersion: string;
  /** Overrides the shipped Registry for the `"bundled"` source. */
  readonly bundledRegistryPath?: string | undefined;
  readonly adapters?: RegistryAdapters | undefined;
  /**
   * Whether `--registry github:owner/repo#<ref>` may move the Pin of a Lockfile Registry; only
   * `update` sets it. Otherwise a ref that resolves to another commit is `INVALID_INPUT`.
   */
  readonly allowPinMove?: boolean;
}

/** A `github:` Pin that `--registry` moved. */
export interface PinMove {
  readonly registry: string;
  readonly from: string;
  readonly to: string;
}

/** Every Registry a command reads, opened, checked for name clashes and trusted. */
export interface ProjectRegistries {
  /** Registry key (the Lockfile key, or the declared name of a new one) to the opened Registry. */
  readonly registries: Map<string, Registry>;
  /** The Registries exactly as the Lockfile on disk records them, before any Pin moved. */
  readonly lockedRegistries: Map<string, Registry>;
  /** The key `--registry` named, when given. */
  readonly flagged: string | undefined;
  /** The Lockfile `registries` entries to record: moved Pins, new Registries and `trusted`. */
  readonly entries: Lockfile["registries"];
  readonly movedPins: readonly PinMove[];
  readonly decisions: readonly TrustDecision[];
}

type LockfileRegistries = Pick<Lockfile, "registries"> & {
  /** The locked Modules, whose integrities authenticate a Registry read from a kept index. */
  readonly modules?: Lockfile["modules"];
};

/** Module `name@version` to the integrity the Lockfile pins for it in one Registry. */
type PinnedIntegrities = ReadonlyMap<string, string>;

function pinnedIntegrities(lockfile: LockfileRegistries, key: string): PinnedIntegrities {
  return new Map(
    Object.entries(lockfile.modules ?? {})
      .filter(([, entry]) => entry.registry === key)
      .map(([name, entry]) => [`${name}@${entry.version}`, entry.integrity]),
  );
}

function requiredRegistry<Entry>(registries: ReadonlyMap<string, Entry>, key: string): Entry {
  const registry = registries.get(key);
  if (registry === undefined) {
    throw new AokitError("INTERNAL", `Registry "${key}" was not opened`, "report the issue");
  }
  return registry;
}

function resolutionRank(registry: Pick<Registry, "source">): number {
  return registry.source.kind === "local" ? 1 : registry.source.kind === "bundled" ? 3 : 2;
}

function isFirstParty(registry: Registry): boolean {
  return registry.source.kind === "bundled" || registry.source.kind === "local";
}

function cacheFor(adapters: RegistryAdapters | undefined): RegistryCache {
  return (
    adapters?.cache ??
    createRegistryCache({ dir: join(xdgCacheDir(adapters?.env ?? process.env), "registry") })
  );
}

const indexDocumentPattern = /\/(?:index\.json|catalog\/[^/]+\.json)$/;

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readKept(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

/**
 * Wraps `fetch` so the last `index.json` and Catalog read from each URL are kept on disk and
 * served when the network is unreachable: the Module versions come from the Module cache, so a
 * read-only command works offline. An HTTP error is never replaced; a kept Catalog is still
 * verified against the index, and every Module version against its integrity.
 */
function keepingIndexDocuments(
  fetchImpl: typeof fetch,
  dir: string,
  onKeptCopy: (url: string) => void,
): typeof fetch {
  const keep = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = join(dir, `${new Bun.CryptoHasher("sha256").update(url).digest("hex")}.json`);
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const kept = await readKept(path);
      if (kept === undefined) throw error;
      onKeptCopy(url);
      return new Response(kept, { status: 200 });
    }
    if (response.status !== 200) return response;
    const text = await response.text();
    await mkdir(dir, { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
    return new Response(text, { status: 200, headers: response.headers });
  };
  const wrapped = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return indexDocumentPattern.test(new URL(url).pathname)
      ? keep(url, init)
      : fetchImpl(input, init);
  };
  return Object.assign(wrapped, { preconnect: fetchImpl.preconnect });
}

/**
 * A Registry whose index is the kept offline copy. That copy is not authenticated, so it may only
 * serve the Module versions the Lockfile pins, and only when the index lists the integrity the
 * Lockfile recorded, and only the Catalog of the Release the Lockfile records: anything else would
 * let an edited copy vouch for planted cache entries or move the Project to a forged Release.
 */
function pinnedToLockfile(
  registry: Registry,
  pinned: PinnedIntegrities,
  lockedRelease: string | undefined,
): Registry {
  return {
    ...registry,
    catalog(release) {
      if (release === lockedRelease) return registry.catalog(release);
      return Promise.reject(
        new RegistryError(
          "REGISTRY_INTEGRITY_MISMATCH",
          `Registry "${registry.name}" is unreachable, and its kept offline index offers Release ${release}, but aokit.lock.json records ${lockedRelease ?? "no Release"}.`,
          "Reconnect to the network so the index is read and verified again, or delete the kept copies under $XDG_CACHE_HOME/aokit/registry-index.",
          { registry: registry.name, expected: lockedRelease ?? "", actual: release },
        ),
      );
    },
    version(name, version) {
      const module = `${name}@${version}`;
      const expected = pinned.get(module);
      if (expected === undefined) {
        return Promise.reject(
          new RegistryError(
            "REGISTRY_FETCH_FAILED",
            `Registry "${registry.name}" is unreachable, and its kept offline index cannot vouch for ${module}, which aokit.lock.json does not pin.`,
            "Reconnect to the network and run the command again.",
            { registry: registry.name, module },
          ),
        );
      }
      const listed = registry.index.modules[name]?.versions[version]?.integrity;
      if (listed !== undefined && listed !== expected) {
        return Promise.reject(
          new RegistryError(
            "REGISTRY_INTEGRITY_MISMATCH",
            `Registry "${registry.name}" kept offline index lists ${module} with integrity ${listed}, but aokit.lock.json pins ${expected}.`,
            "Reconnect to the network so the index is read again, or delete the kept copies under $XDG_CACHE_HOME/aokit/registry-index.",
            { registry: registry.name, module, expected, actual: listed },
          ),
        );
      }
      return registry.version(name, version);
    },
  };
}

async function openSource(
  source: RegistrySource,
  options: LoadProjectRegistriesOptions,
  cache: RegistryCache,
  pinned: PinnedIntegrities = new Map(),
  lockedRelease?: string,
): Promise<Registry> {
  const { adapters } = options;
  const documents = join(xdgCacheDir(adapters?.env ?? process.env), "registry-index");
  let indexKept = false;
  const registry = await openRegistry(source, {
    cliVersion: options.cliVersion,
    cache,
    fetch: keepingIndexDocuments(adapters?.fetch ?? fetch, documents, (url) => {
      if (url.endsWith("/index.json")) indexKept = true;
    }),
    ...(adapters?.github === undefined ? {} : { github: { ...adapters.github } }),
  });
  if (!indexKept) return registry;
  const guarded = pinnedToLockfile(registry, pinned, lockedRelease);
  keptIndexRegistries.add(guarded);
  return guarded;
}

/** The Registries opened from a kept offline index, whose Catalogs nothing authenticates. */
const keptIndexRegistries = new WeakSet<Registry>();

/**
 * Checks a Render whose Catalog came from `registry` against the Lockfile it started from. When the
 * Registry was opened from its kept offline index, its Catalog is unauthenticated, so every
 * Catalog dependency the Render records must already be in the Lockfile with the same version;
 * anything else is `REGISTRY_INTEGRITY_MISMATCH`. Online Catalogs are verified by the index.
 */
export function assertCatalogDepsAuthenticated(
  registry: Registry | undefined,
  previous: Pick<Lockfile, "deps">,
  next: Pick<Lockfile, "deps">,
): void {
  if (registry === undefined || !keptIndexRegistries.has(registry)) return;
  for (const [name, entry] of Object.entries(next.deps).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (entry.source !== "catalog") continue;
    const locked = previous.deps[name];
    const recorded = locked?.source === "catalog" ? locked.version : undefined;
    if (recorded === entry.version && locked?.pinned === entry.pinned) continue;
    throw new RegistryError(
      "REGISTRY_INTEGRITY_MISMATCH",
      `Registry "${registry.name}" is unreachable, and its kept offline Catalog sets ${name} to ${entry.version}, but aokit.lock.json records ${recorded ?? "no Catalog version"}.`,
      "Reconnect to the network so the Catalog is read and verified again, or delete the kept copies under $XDG_CACHE_HOME/aokit/registry-index.",
      {
        registry: registry.name,
        path: `deps.${name}`,
        expected: recorded ?? "",
        actual: entry.version,
      },
    );
  }
}

function clash(name: string, first: string, second: string): AokitError {
  return new AokitError(
    "INVALID_INPUT",
    `Two Registries declare the name "${name}" with different sources: ${first} and ${second}.`,
    "Give each Registry its own name, or point both at the same source.",
    { registry: name, sources: [first, second] },
  );
}

function assertUniqueNames(registries: ReadonlyMap<string, Registry>): void {
  const byName = new Map<string, Registry>();
  for (const registry of registries.values()) {
    const known = byName.get(registry.name);
    if (known !== undefined && sourceIdentity(known.source) !== sourceIdentity(registry.source)) {
      throw clash(
        registry.name,
        formatRegistrySource(known.source),
        formatRegistrySource(registry.source),
      );
    }
    byName.set(registry.name, registry);
  }
}

/** The source string a Lockfile records for a Registry opened from `--registry`. */
function recordedSource(registry: Registry, projectDir: string): string {
  if (registry.source.kind === "local") {
    return relative(projectDir, registry.source.path) || ".";
  }
  return formatRegistrySource(registry.source);
}

async function openLocked(
  lockfile: LockfileRegistries,
  options: LoadProjectRegistriesOptions,
  context: RegistrySourceContext,
  cache: RegistryCache,
): Promise<Map<string, Registry>> {
  const opened = await Promise.all(
    Object.entries(lockfile.registries).map(
      async ([key, entry]) =>
        [
          key,
          await openSource(
            parseSource(entry.source, context),
            options,
            cache,
            pinnedIntegrities(lockfile, key),
            entry.release,
          ),
        ] as const,
    ),
  );
  return new Map(opened);
}

interface FlagOutcome {
  readonly key: string;
  readonly registry: Registry | undefined;
  readonly movedFrom: string | undefined;
}

async function openFlag(
  flag: string,
  lockfile: LockfileRegistries,
  locked: ReadonlyMap<string, Registry>,
  options: LoadProjectRegistriesOptions,
  context: RegistrySourceContext,
  cache: RegistryCache,
): Promise<FlagOutcome> {
  if (lockfile.registries[flag] !== undefined) {
    return { key: flag, registry: undefined, movedFrom: undefined };
  }
  const registry = await openSource(parseSource(flag, context), options, cache);
  const known = locked.get(registry.name);
  if (known === undefined) {
    return { key: registry.name, registry, movedFrom: undefined };
  }
  if (sourceIdentity(known.source) !== sourceIdentity(registry.source)) {
    throw clash(
      registry.name,
      formatRegistrySource(known.source),
      formatRegistrySource(registry.source),
    );
  }
  const before = formatRegistrySource(known.source);
  const after = formatRegistrySource(registry.source);
  const moved = registry.source.kind === "github" && before !== after ? before : undefined;
  if (moved !== undefined && options.allowPinMove !== true) {
    throw new AokitError(
      "INVALID_INPUT",
      `--registry ${flag} resolves Registry "${registry.name}" to ${after}, but aokit.lock.json pins it at ${before}.`,
      `Only \`aokit update --registry ${flag}\` moves a Pin. Pass --registry ${registry.name} to use the pinned commit.`,
      { registry: registry.name, from: before, to: after },
    );
  }
  return { key: registry.name, registry, movedFrom: moved };
}

/**
 * Opens every Registry the Lockfile lists and the one `--registry` names, through the Registry
 * client and its cache, then runs the trust gate over all of them. A `--registry` source whose
 * declared name a Lockfile Registry already uses must be the same host or repository; a different
 * `github:` ref of the same repository moves its Pin. Two Registries declaring one name with
 * different sources fail with `INVALID_INPUT` naming both sources.
 */
export async function openProjectRegistries(
  lockfile: LockfileRegistries | undefined,
  options: LoadProjectRegistriesOptions,
): Promise<ProjectRegistries> {
  const locked = lockfile ?? { registries: {} };
  const projectDir = options.projectDir ?? process.cwd();
  const context = {
    projectDir,
    bundledRegistryPath: options.bundledRegistryPath ?? shippedRegistryPath,
  };
  const cache = cacheFor(options.adapters);
  const lockedRegistries = await openLocked(locked, options, context, cache);
  assertUniqueNames(lockedRegistries);
  const flag =
    options.registryFlag === undefined
      ? undefined
      : await openFlag(options.registryFlag, locked, lockedRegistries, options, context, cache);
  const registries = new Map(lockedRegistries);
  const entries: Lockfile["registries"] = { ...locked.registries };
  if (flag?.registry !== undefined) {
    registries.set(flag.key, flag.registry);
    const previous = entries[flag.key];
    entries[flag.key] = {
      source:
        previous !== undefined && flag.movedFrom === undefined
          ? previous.source
          : recordedSource(flag.registry, projectDir),
      release: previous?.release ?? flag.registry.release,
      minCliVersion: previous?.minCliVersion ?? flag.registry.index.minCliVersion,
      ...(previous?.trusted === undefined ? {} : { trusted: previous.trusted }),
    };
  }
  const keys = [...registries.keys()];
  const decisions = await ensureTrusted(
    keys.map((key) => requiredRegistry(registries, key)),
    {
      trustFlags: options.trustFlags,
      ...(lockfile === undefined ? {} : { lockfile }),
      interactive: options.interactive,
      ...(options.adapters?.prompt === undefined ? {} : { prompt: options.adapters.prompt }),
      ...(options.adapters?.userConfig === undefined
        ? {}
        : { userConfig: options.adapters.userConfig }),
      ...(options.adapters?.env === undefined ? {} : { env: options.adapters.env }),
    },
  );
  for (const [position, decision] of decisions.entries()) {
    const key = keys[position] ?? "";
    const entry = entries[key];
    if (entry !== undefined && decision.lockfileTrusted) {
      entries[key] = { ...entry, trusted: true };
    }
  }
  const movedPins =
    flag?.movedFrom === undefined
      ? []
      : [{ registry: flag.key, from: flag.movedFrom, to: entries[flag.key]?.source ?? "" }];
  return {
    registries,
    lockedRegistries,
    flagged: flag?.key,
    entries,
    movedPins,
    decisions,
  };
}

/**
 * Opens the Lockfile's Registries, and the one `--registry` names, through the Registry client,
 * the cache and the trust gate; keyed by Lockfile key (or declared name for a new Registry).
 */
export async function loadProjectRegistries(
  lockfile: LockfileRegistries | undefined,
  options: LoadProjectRegistriesOptions,
): Promise<Map<string, Registry>> {
  return (await openProjectRegistries(lockfile, options)).registries;
}

/**
 * The order a Module name is looked up in: the `--registry` one, then local, then remote
 * Registries in Lockfile order, then the bundled one.
 */
export function resolutionOrder(set: {
  readonly registries: ReadonlyMap<string, Pick<Registry, "source">>;
  readonly flagged: string | undefined;
}): string[] {
  const keys = [...set.registries.keys()].filter((key) => key !== set.flagged);
  const ordered = keys
    .map((key, position) => ({
      key,
      position,
      rank: resolutionRank(requiredRegistry(set.registries, key)),
    }))
    .toSorted((left, right) => left.rank - right.rank || left.position - right.position)
    .map(({ key }) => key);
  return set.flagged === undefined ? ordered : [set.flagged, ...ordered];
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
  const first = Object.keys(lockfile.modules).toSorted()[0];
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
export interface LoadedRegistry {
  readonly registry: Registry;
  /** The source the Lockfile records: `bundled`, a path relative to the Project, a URL or a Pin. */
  readonly source: string;
  readonly minCliVersion: string;
  /** Whether the Lockfile records the Registry as trusted. */
  readonly trusted: boolean;
  readonly available: readonly PipelineModule[];
}

/** Inputs of {@link loadRegistry} besides the flag and CLI version. */
export interface LoadRegistryOptions {
  /** The new Project's directory; a local Registry path is recorded relative to it. */
  readonly projectDir?: string;
  readonly trustFlags?: readonly string[];
  readonly interactive?: boolean;
  readonly adapters?: RegistryAdapters | undefined;
}

/**
 * Opens the Registry `registryFlag` names (a source, resolved from the working directory), or the
 * bundled one, through the trust gate, and wraps the newest selectable version of each Module.
 */
export async function loadRegistry(
  registryFlag: string | undefined,
  cliVersion: string,
  options: LoadRegistryOptions = {},
): Promise<LoadedRegistry> {
  const set = await openProjectRegistries(undefined, {
    registryFlag: registryFlag ?? "bundled",
    trustFlags: options.trustFlags ?? [],
    interactive: options.interactive ?? false,
    projectDir: process.cwd(),
    cliVersion,
    adapters: options.adapters,
  });
  const key = set.flagged ?? "";
  const registry = requiredRegistry(set.registries, key);
  const entry = set.entries[key];
  const source =
    registry.source.kind === "local"
      ? relative(resolvePath(options.projectDir ?? "."), registry.source.path) || "."
      : formatRegistrySource(registry.source);
  return {
    registry,
    source,
    minCliVersion: registry.index.minCliVersion,
    trusted: entry?.trusted === true,
    available: await newestModules(registry),
  };
}
