import { join, relative } from "node:path";
import { AokitError } from "../../cli/envelope.ts";
import type { UserConfig } from "../../config/user-config.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { createRegistryCache } from "../../registry/cache.ts";
import type { GitLsRemote } from "../../registry/github.ts";
import {
  formatRegistrySource,
  parseRegistrySource,
  type Registry,
  type RegistryCache,
  RegistryError,
  type RegistrySource,
} from "../../registry/index.ts";
import type { TrustDecision } from "../../trust/gate.ts";
import { xdgCacheDir } from "../../xdg.ts";

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

export function parseSource(source: string, context: RegistrySourceContext): RegistrySource {
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

export type LockfileRegistries = Pick<Lockfile, "registries"> & {
  /** The locked Modules, whose integrities authenticate a Registry read from a kept index. */
  readonly modules?: Lockfile["modules"];
};

/** Module `name@version` to the integrity the Lockfile pins for it in one Registry. */
export type PinnedIntegrities = ReadonlyMap<string, string>;

export function pinnedIntegrities(lockfile: LockfileRegistries, key: string): PinnedIntegrities {
  return new Map(
    Object.entries(lockfile.modules ?? {})
      .filter(([, entry]) => entry.registry === key)
      .map(([name, entry]) => [`${name}@${entry.version}`, entry.integrity]),
  );
}

export function requiredRegistry<Entry>(
  registries: ReadonlyMap<string, Entry>,
  key: string,
): Entry {
  const registry = registries.get(key);
  if (registry === undefined) {
    throw new AokitError("INTERNAL", `Registry "${key}" was not opened`, "report the issue");
  }
  return registry;
}

export function cacheFor(adapters: RegistryAdapters | undefined): RegistryCache {
  return (
    adapters?.cache ??
    createRegistryCache({ dir: join(xdgCacheDir(adapters?.env ?? process.env), "registry") })
  );
}

export function clash(name: string, first: string, second: string): AokitError {
  return new AokitError(
    "INVALID_INPUT",
    `Two Registries declare the name "${name}" with different sources: ${first} and ${second}.`,
    "Give each Registry its own name, or point both at the same source.",
    { registry: name, sources: [first, second] },
  );
}

/** The source string a Lockfile records for a Registry opened from `--registry`. */
export function recordedSource(registry: Registry, projectDir: string): string {
  if (registry.source.kind === "local") {
    return relative(projectDir, registry.source.path) || ".";
  }
  return formatRegistrySource(registry.source);
}
