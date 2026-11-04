import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve as resolvePath } from "node:path";
import { AokitError } from "../cli/envelope.ts";
import { toAokitError } from "./errors.ts";
import type { UserConfig } from "../config/user-config.ts";
import type { PipelineModule } from "../pipeline/index.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { bundledRegistryPath as shippedRegistryPath } from "../registry/bundled.ts";
import type { ModuleManifest } from "@aokit/module";
import { createRegistryCache } from "../registry/cache.ts";
import {
  type GitLsRemote,
  githubRawBaseUrl,
  gitLsRemote,
  pinnedGithubSource,
  resolveGithubPin,
} from "../registry/github.ts";
import { computeIntegrity, type Integrity } from "../registry/integrity.ts";
import { adaptShadcnItem } from "../registry/shadcn/adapt.ts";
import { type ShadcnItem, shadcnItemSchema } from "../registry/shadcn/schema.ts";
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

/** What {@link openSource} passes on besides the source. */
interface OpenSourceExtras {
  /** Module `name@version` to the integrity the Lockfile pins for the Registry being opened. */
  readonly pinned?: PinnedIntegrities;
  readonly lockedRelease?: string | undefined;
  /** The shadcn items to read at open; every item `registry.json` lists when absent. */
  readonly items?: readonly string[];
  /**
   * Whether a shadcn `registry.json` the host does not serve reads as an empty index: for a
   * Registry the Lockfile records or one opened for explicit items, never for a bare `--registry`.
   */
  readonly indexOptional?: boolean;
  /** The source a shadcn Registry reports instead of its URL: the Pin of a `github:` source. */
  readonly reportedSource?: RegistrySource;
}

const shadcnIndexPath = /\/registry\.json$/;
const jsonPath = /\.json$/;

/**
 * Wraps `fetch` so every JSON document read while a Registry opens is kept in `captured`, which is
 * how the raw shadcn items (and their `registryDependencies`, which the Adapted Module drops) are
 * seen. With `synthesizeIndex`, a `registry.json` the host does not serve (404) reads as an empty
 * index, so a single item URL opens without one: only requested and pinned items are read then.
 */
function capturingItems(
  fetchImpl: typeof fetch,
  captured: string[],
  synthesizeIndex: boolean,
): typeof fetch {
  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await fetchImpl(input, init);
    const { pathname } = new URL(url);
    if (synthesizeIndex && response.status === 404 && shadcnIndexPath.test(pathname)) {
      return new Response('{"items":[]}', { status: 200 });
    }
    if (response.status === 200 && jsonPath.test(pathname) && !shadcnIndexPath.test(pathname)) {
      captured.push(await response.clone().text());
    }
    return response;
  };
  return Object.assign(wrapped, { preconnect: fetchImpl.preconnect });
}

async function openSource(
  source: RegistrySource,
  options: LoadProjectRegistriesOptions,
  cache: RegistryCache,
  extras: OpenSourceExtras = {},
): Promise<Registry> {
  const pinned = extras.pinned ?? new Map<string, string>();
  if (source.kind === "github") {
    return openGithubSource(source, options, cache, extras);
  }
  const { adapters } = options;
  const documents = join(xdgCacheDir(adapters?.env ?? process.env), "registry-index");
  let indexKept = false;
  const captured: string[] = [];
  const synthesizeIndex =
    source.kind === "shadcn" &&
    (extras.indexOptional === true || (extras.items?.length ?? 0) > 0 || pinned.size > 0);
  const registry = await openRegistry(source, {
    cliVersion: options.cliVersion,
    cache,
    fetch: keepingIndexDocuments(
      capturingItems(adapters?.fetch ?? fetch, captured, synthesizeIndex),
      documents,
      (url) => {
        if (url.endsWith("/index.json")) indexKept = true;
      },
    ),
    ...(adapters?.github === undefined ? {} : { github: { ...adapters.github } }),
    pinned,
    ...(options.projectDir === undefined ? {} : { projectDir: options.projectDir }),
    ...(adapters?.env === undefined ? {} : { env: adapters.env }),
    ...(adapters?.userConfig === undefined ? {} : { userConfig: adapters.userConfig }),
    ...(extras.items === undefined ? {} : { items: extras.items }),
  });
  if (registry.source.kind === "shadcn") {
    const reported =
      extras.reportedSource === undefined
        ? registry
        : { ...registry, source: extras.reportedSource };
    return withRegistryDependencies(reported, captured, cache);
  }
  if (!indexKept) return registry;
  const guarded = pinnedToLockfile(registry, pinned, extras.lockedRelease);
  keptIndexRegistries.add(guarded);
  return guarded;
}

/**
 * Opens a `github:` source: an aokit Registry at the root of the pinned repository, or, when the
 * repository serves no `index.json`, the shadcn items at its root, reported (and recorded) as the
 * same `github:owner/repo#<sha40>` Pin so trust stays bound to the repository.
 */
async function openGithubSource(
  source: Extract<RegistrySource, { kind: "github" }>,
  options: LoadProjectRegistriesOptions,
  cache: RegistryCache,
  extras: OpenSourceExtras,
): Promise<Registry> {
  const github = options.adapters?.github;
  const pin = await resolveGithubPin(source, { lsRemote: github?.lsRemote ?? gitLsRemote });
  const pinnedSource = pinnedGithubSource(pin);
  const opened = async (): Promise<Registry | undefined> => {
    try {
      return await openNonGithub(pinnedSource, options, cache, extras);
    } catch (error) {
      if (error instanceof RegistryError && error.code === "REGISTRY_NOT_FOUND") return undefined;
      throw error;
    }
  };
  const pinsAdaptedModules = [...(extras.pinned?.keys() ?? [])].some((key) => key.startsWith("@"));
  const aokit = pinsAdaptedModules || extras.items !== undefined ? undefined : await opened();
  if (aokit !== undefined) return aokit;
  const rawBase = (github?.rawBaseUrl ?? githubRawBaseUrl).replace(/\/$/, "");
  return openSource(
    {
      kind: "shadcn",
      url: `${rawBase}/${encodeURIComponent(pin.owner)}/${encodeURIComponent(pin.repo)}/${pin.sha}`,
    },
    options,
    cache,
    { ...extras, items: extras.items ?? [], reportedSource: pinnedSource },
  );
}

/** How one `registryDependencies` entry addresses the item it names. */
type RegistryDependencyForm = "bare" | "namespaced" | "github" | "url" | "path";

/**
 * One parsed `registryDependencies` entry. `address` is the Module name for `bare` (scoped to the
 * owner's Registry) and `namespaced`, `github:owner/repo/item#ref` for `github`, and the entry as
 * written for `url` and `path`.
 */
export interface RegistryDependency {
  readonly form: RegistryDependencyForm;
  readonly address: string;
}

const itemNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const namespacedPattern = /^@[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const githubItemPattern =
  /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)#([^\s#]+)$/;
const githubAddressPattern = /^github:([^/]+)\/([^/]+)\/([^#]+)#(.+)$/;
const urlEntryPattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const pathEntryPattern = /^(?:\.{1,2}\/|\/)/;

/**
 * Parses a `registryDependencies` entry of an item served by the Registry `owner.registry` into
 * one of the five address forms: a bare item name (same Registry), `@ns/item`,
 * `owner/repo/item#ref` (the `github:` transport, pinned to a sha40), an item URL and a local
 * path. Throws `REGISTRY_SOURCE_UNSUPPORTED` naming the entry for anything else.
 */
export function parseRegistryDependency(
  entry: string,
  owner: { registry: string },
): RegistryDependency {
  if (urlEntryPattern.test(entry)) {
    return { form: "url", address: entry };
  }
  if (pathEntryPattern.test(entry)) {
    return { form: "path", address: entry };
  }
  if (namespacedPattern.test(entry)) {
    return { form: "namespaced", address: entry };
  }
  const github = githubItemPattern.exec(entry);
  if (github !== null) {
    const [, repoOwner = "", repo = "", item = "", ref = ""] = github;
    return { form: "github", address: `github:${repoOwner}/${repo}/${item}#${ref}` };
  }
  if (itemNamePattern.test(entry)) {
    return { form: "bare", address: `@${owner.registry.replace(/^@/, "")}/${entry}` };
  }
  throw new RegistryError(
    "REGISTRY_SOURCE_UNSUPPORTED",
    `Registry "${owner.registry}" lists the registryDependencies entry "${entry}", which is not an item name, @namespace/item, owner/repo/item#ref, an item URL or a local path.`,
    "Report the item to its Registry maintainer.",
    { registry: owner.registry, module: entry },
  );
}

/** A capability segment: lowercase kebab-case, whatever the item or scope is spelled as. */
function capabilitySegment(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug === "" ? "x" : slug;
}

/** The capability an Adapted Module provides under its own name, `@scope/item`. */
function nameCapability(moduleName: string): string {
  const [scope = "", item = ""] = moduleName.replace(/^@/, "").split("/");
  return `shadcn:${capabilitySegment(scope)}:${capabilitySegment(item)}`;
}

/** The capability an item provides at a location: its Registry's trust identity plus its name. */
function locationCapability(identity: string, item: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(`${identity}/${item}`).digest("hex");
  return `shadcn-at:${digest.slice(0, 16)}`;
}

/** Splits an item URL `<base>/<item>.json` into its shadcn Registry and item name. */
function itemUrl(address: string): { source: RegistrySource; item: string } {
  const url = new URL(address);
  const cut = url.pathname.lastIndexOf("/");
  const file = url.pathname.slice(cut + 1);
  if (!file.endsWith(".json") || url.search !== "" || url.hash !== "") {
    throw new RegistryError(
      "REGISTRY_SOURCE_UNSUPPORTED",
      `"${address}" is not the URL of a shadcn item JSON file.`,
      "Use the URL of one item, such as https://example.com/r/button.json.",
      { registry: address },
    );
  }
  const base = `${url.origin}${url.pathname.slice(0, cut)}`;
  const source = parseRegistrySource(`${base}/registry.json`, {
    projectDir: "/",
    bundledRegistryPath: "/",
  });
  return { source, item: decodeURIComponent(file.slice(0, -".json".length)) };
}

/** The capability a parsed dependency requires, the same its provider offers. */
function dependencyCapability(dependency: RegistryDependency): string {
  if (dependency.form === "bare" || dependency.form === "namespaced") {
    return nameCapability(dependency.address);
  }
  if (dependency.form === "github") {
    const [, owner = "", repo = "", item = ""] =
      githubAddressPattern.exec(dependency.address) ?? [];
    return locationCapability(sourceIdentity({ kind: "github", owner, repo, ref: "HEAD" }), item);
  }
  if (dependency.form === "url") {
    const { source, item } = itemUrl(dependency.address);
    return locationCapability(sourceIdentity(source), item);
  }
  return locationCapability(`path:${dependency.address}`, dependency.address);
}

/** The raw item of an Adapted Module and the `registryDependencies` it lists. */
const itemDependencies = new WeakMap<ModuleVersion, readonly string[]>();

/** Where the raw item JSON of an Adapted Module is kept in the integrity cache. */
function itemRecordKey(moduleIntegrity: string): Integrity {
  return computeIntegrity(`aokit-shadcn-item\n${moduleIntegrity}`);
}

/** The item `text` parses to when it adapts, under `scope`, to a Module of that integrity. */
function verifiedItem(
  text: string,
  scope: string,
): { integrity: string; item: ShadcnItem } | undefined {
  try {
    const parsed = shadcnItemSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return undefined;
    return { integrity: adaptShadcnItem(parsed.data, { scope }).integrity, item: parsed.data };
  } catch {
    return undefined;
  }
}

/**
 * Wraps an opened shadcn Registry so each Adapted Module also provides its name (and location)
 * capability and requires the ones of its `registryDependencies`, which the Resolver then orders,
 * pulls in and checks for cycles. The raw item comes from this open's reads, else from its record
 * in the integrity cache, verified by adapting it again to the Module's integrity; the integrity
 * itself is never changed.
 */
async function withRegistryDependencies(
  registry: Registry,
  captured: readonly string[],
  cache: RegistryCache,
): Promise<Registry> {
  const items = new Map<string, ShadcnItem>();
  for (const text of captured) {
    const verified = verifiedItem(text, registry.name);
    if (verified === undefined) continue;
    items.set(verified.integrity, verified.item);
    // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of records, written in order
    await cache.put(itemRecordKey(verified.integrity), { manifest: text, files: new Map() });
  }
  const itemOf = async (version: ModuleVersion): Promise<ShadcnItem | undefined> => {
    const known = items.get(version.integrity);
    if (known !== undefined) return known;
    const record = await cache.get(itemRecordKey(version.integrity)).catch(() => undefined);
    const verified =
      record === undefined ? undefined : verifiedItem(record.manifest, registry.name);
    return verified?.integrity === version.integrity ? verified.item : undefined;
  };
  const isNamespace = registry.source.kind === "shadcn" && registry.source.namespace !== undefined;
  const augmented = new Map<string, Promise<ModuleVersion>>();
  const augment = async (name: string, version: string): Promise<ModuleVersion> => {
    const loaded = await registry.version(name, version);
    const item = await itemOf(loaded);
    const dependencies = item?.registryDependencies ?? [];
    const requires = dependencies.map((entry) =>
      dependencyCapability(parseRegistryDependency(entry, { registry: registry.name })),
    );
    const itemName = name.slice(name.indexOf("/") + 1);
    const provides = [
      nameCapability(name),
      ...(isNamespace ? [] : [locationCapability(sourceIdentity(registry.source), itemName)]),
    ];
    const manifest: ModuleManifest = {
      ...loaded.manifest,
      provides: [
        ...loaded.manifest.provides,
        ...provides.map((capability) => ({ capability, cardinality: { max: 1 } })),
      ],
      requires: [...new Set([...loaded.manifest.requires, ...requires])],
    };
    const wrapped: ModuleVersion = { ...loaded, manifest };
    itemDependencies.set(wrapped, dependencies);
    return wrapped;
  };
  return {
    ...registry,
    version(name, version) {
      const key = `${name}@${version}`;
      const known = augmented.get(key);
      if (known !== undefined) return known;
      const loading = augment(name, version);
      augmented.set(key, loading);
      loading.catch(() => augmented.delete(key));
      return loading;
    },
  };
}

/** Opens a pinned `github:` source as an aokit Registry, through the kept-index path. */
async function openNonGithub(
  source: Extract<RegistrySource, { kind: "github" }>,
  options: LoadProjectRegistriesOptions,
  cache: RegistryCache,
  extras: OpenSourceExtras,
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
  const guarded = pinnedToLockfile(registry, extras.pinned ?? new Map(), extras.lockedRelease);
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
          await openSource(parseSource(entry.source, context), options, cache, {
            pinned: pinnedIntegrities(lockfile, key),
            lockedRelease: entry.release,
            indexOptional: true,
          }),
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

/** A requested Module and the Registry key it is read from. */
interface AddressedModule {
  readonly key: string;
  readonly version: ModuleVersion;
}

/** What {@link openShadcnAddresses} found: the grown Registry set, names and Adapted Modules. */
export interface ShadcnAddressing {
  /** The Registries of the run, with every shadcn Registry an address or dependency needed. */
  readonly set: ProjectRegistries;
  /** The requested entries as Module names: an item URL or `owner/repo/item#ref` becomes `@ns/item`. */
  readonly names: readonly string[];
  /** The requested Adapted Modules and their `registryDependencies`, transitively, newest versions. */
  readonly modules: readonly AddressedModule[];
}

function scopeOf(registry: Pick<Registry, "name">): string {
  return registry.name.replace(/^@/, "");
}

function isShadcnRegistry(registry: Registry): boolean {
  return Object.values(registry.index.modules).every((entry) =>
    Object.keys(entry.versions).every((version) => version.startsWith("0.0.0-shadcn.")),
  );
}

function dependencyCycle(cycle: readonly string[]): AokitError {
  return new AokitError(
    "CAPABILITY_CONFLICT",
    `shadcn items depend on each other through registryDependencies: ${cycle.join(" -> ")}.`,
    `Ask the Registry maintainer to break the cycle between ${[...new Set(cycle)].join(" and ")}; aokit installs no item that depends on itself.`,
    { modules: [...new Set(cycle)] },
  );
}

function dependencyNotServed(
  dependency: RegistryDependency,
  target: AddressedModuleName,
  dependent: string,
): RegistryError {
  const served = dependency.address === target.name ? "" : ` (Module "${target.name}")`;
  return new RegistryError(
    "REGISTRY_MODULE_NOT_FOUND",
    `"${dependent}" lists the registryDependencies item "${dependency.address}"${served}, which its Registry does not serve.`,
    `Ask the maintainer of "${dependent}" to publish "${dependency.address}" or drop it from registryDependencies.`,
    { registry: target.key, module: target.name, path: dependency.address },
  );
}

function pathUnsupported(address: string): RegistryError {
  return new RegistryError(
    "REGISTRY_SOURCE_UNSUPPORTED",
    `The local shadcn item "${address}" cannot be read: a local path is read only as an aokit Registry directory.`,
    "Serve the item over http(s), or publish it under a Namespace, and depend on that address instead.",
    { registry: address },
  );
}

/**
 * Resolves the shadcn addresses among `requested` (`@ns/item`, an item URL, `owner/repo/item#ref`)
 * to Module names, opening the shadcn Registry each one needs, then walks the
 * `registryDependencies` of every requested Adapted Module, opening each other Registry they name.
 * Every Registry this opens goes through the trust gate on its own, and is added to `set` with its
 * Lockfile entry; a Registry already in `set` is opened again to read the extra items. Plain names
 * are kept as they are. A dependency cycle fails with `CAPABILITY_CONFLICT` naming the items.
 */
export async function openShadcnAddresses(
  set: ProjectRegistries,
  lockfile: LockfileRegistries,
  requested: readonly string[],
  options: LoadProjectRegistriesOptions,
): Promise<ShadcnAddressing> {
  const projectDir = options.projectDir ?? process.cwd();
  const cache = cacheFor(options.adapters);
  const registries = new Map(set.registries);
  const entries: Lockfile["registries"] = { ...set.entries };
  const decisions: TrustDecision[] = [];
  const trustOpened = async (key: string): Promise<void> => {
    const [decision] = await ensureTrusted([requiredRegistry(registries, key)], {
      trustFlags: options.trustFlags,
      lockfile,
      interactive: options.interactive,
      ...(options.adapters?.prompt === undefined ? {} : { prompt: options.adapters.prompt }),
      ...(options.adapters?.userConfig === undefined
        ? {}
        : { userConfig: options.adapters.userConfig }),
      ...(options.adapters?.env === undefined ? {} : { env: options.adapters.env }),
    });
    if (decision === undefined) return;
    decisions.push(decision);
    const entry = entries[key];
    if (entry !== undefined && decision.lockfileTrusted) entries[key] = { ...entry, trusted: true };
  };
  const keyFor = (source: RegistrySource): string | undefined => {
    const identity = sourceIdentity(source);
    return [...registries.keys()].find((key) => {
      const registry = requiredRegistry(registries, key);
      if (source.kind === "shadcn" && source.namespace !== undefined) {
        return registry.source.kind === "shadcn" && registry.source.namespace === source.namespace;
      }
      return sourceIdentity(registry.source) === identity;
    });
  };
  const serve = async (source: RegistrySource, item: string): Promise<AddressedModuleName> => {
    const known = keyFor(source);
    if (known !== undefined) {
      const registry = requiredRegistry(registries, known);
      const name = `@${scopeOf(registry)}/${item}`;
      if (registry.selectableVersions(name).length > 0) return { key: known, name };
      const items = [
        ...Object.keys(registry.index.modules).map((module) =>
          module.slice(module.indexOf("/") + 1),
        ),
        item,
      ];
      registries.set(
        known,
        await openSource(registry.source, options, cache, {
          pinned: pinnedIntegrities(lockfile, known),
          items,
        }),
      );
      return { key: known, name };
    }
    const registry = await openSource(source, options, cache, { items: [item] });
    const rival = registries.get(registry.name);
    if (rival !== undefined) {
      throw clash(
        registry.name,
        formatRegistrySource(rival.source),
        formatRegistrySource(registry.source),
      );
    }
    registries.set(registry.name, registry);
    entries[registry.name] = {
      source: recordedSource(registry, projectDir),
      release: registry.release,
      minCliVersion: registry.index.minCliVersion,
    };
    await trustOpened(registry.name);
    return { key: registry.name, name: `@${scopeOf(registry)}/${item}` };
  };
  const locate = async (dependency: RegistryDependency): Promise<AddressedModuleName> => {
    if (dependency.form === "bare" || dependency.form === "namespaced") {
      const [scope = "", item = ""] = dependency.address.slice(1).split("/");
      const owner = [...registries.entries()].find(
        ([, registry]) => scopeOf(registry) === scope && isShadcnRegistry(registry),
      );
      return serve(owner?.[1].source ?? { kind: "shadcn", namespace: `@${scope}`, url: "" }, item);
    }
    if (dependency.form === "url") {
      const { source, item } = itemUrl(dependency.address);
      return serve(source, item);
    }
    if (dependency.form === "github") {
      const [, owner = "", repo = "", item = "", ref = ""] =
        githubAddressPattern.exec(dependency.address) ?? [];
      return serve({ kind: "github", owner, repo, ref }, item);
    }
    throw pathUnsupported(dependency.address);
  };
  const names: string[] = [];
  const roots: AddressedModuleName[] = [];
  for (const entry of requested) {
    const shadcn =
      urlEntryPattern.test(entry) || namespacedPattern.test(entry) || githubItemPattern.test(entry);
    if (!shadcn) {
      names.push(entry);
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Registries open one at a time, in order
    const target = await locate(parseRegistryDependency(entry, { registry: "" }));
    names.push(target.name);
    roots.push(target);
  }
  const modules = new Map<string, AddressedModule>();
  const visit = async (
    target: AddressedModuleName,
    path: readonly string[],
    dependency?: RegistryDependency,
  ): Promise<void> => {
    if (path.includes(target.name)) throw dependencyCycle([...path, target.name]);
    if (modules.has(target.name) || lockfile.modules?.[target.name] !== undefined) return;
    const registry = requiredRegistry(registries, target.key);
    const newest = registry.selectableVersions(target.name).at(-1);
    if (newest === undefined) {
      const dependent = path.at(-1);
      if (dependency === undefined || dependent === undefined) return;
      throw dependencyNotServed(dependency, target, dependent);
    }
    const version = await registry.version(target.name, newest);
    modules.set(target.name, { key: target.key, version });
    for (const entry of itemDependencies.get(version) ?? []) {
      const parsed = parseRegistryDependency(entry, { registry: registry.name });
      // oxlint-disable-next-line eslint/no-await-in-loop -- a depth-first walk, in item order
      const located = await locate(parsed);
      // oxlint-disable-next-line eslint/no-await-in-loop -- a depth-first walk, in item order
      await visit(located, [...path, target.name], parsed);
    }
  };
  for (const root of roots) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a depth-first walk, in request order
    await visit(root, []);
  }
  return {
    set: { ...set, registries, entries, decisions: [...set.decisions, ...decisions] },
    names,
    modules: [...modules.values()],
  };
}

/** A Module name and the Registry key it is read from, before it is read. */
interface AddressedModuleName {
  readonly key: string;
  readonly name: string;
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
