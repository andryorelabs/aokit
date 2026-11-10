import type { ModuleManifest } from "@aokit/module";
import type { UserConfig } from "../../config/user-config.ts";
import { RegistryError } from "../errors.ts";
import type { GitLsRemote } from "../github.ts";
import type { Integrity } from "../integrity.ts";
import type { ReleaseCatalog, RegistryIndex } from "../schema.ts";
import type { RegistrySource } from "../source.ts";

/**
 * The verified content of one Module version as a {@link RegistryCache} stores it: the manifest
 * text and every Module file keyed by its path relative to `modules/<name>/<version>/`.
 */
export interface CachedModuleVersion {
  readonly manifest: string;
  readonly files: ReadonlyMap<string, string>;
}

/**
 * A content-addressed store of fetched Module versions, keyed by Module integrity. The client
 * verifies every hit again and ignores one that fails, then fetches the version and calls `put`,
 * which must overwrite whatever the entry held.
 */
export interface RegistryCache {
  get(integrity: Integrity): Promise<CachedModuleVersion | undefined>;
  put(integrity: Integrity, files: CachedModuleVersion): Promise<void>;
}

/**
 * A Module version read from a Registry and verified against the index: its manifest, its files
 * keyed by the path the manifest's `files[].from` uses, and the published Module integrity.
 */
export interface ModuleVersion {
  readonly name: string;
  readonly version: string;
  readonly manifest: ModuleManifest;
  readonly files: ReadonlyMap<string, string>;
  readonly integrity: Integrity;
  /**
   * Old path to new path (Target-relative, previous version to this one) from the version's
   * `renames.json`; empty when it ships none.
   */
  readonly renames: Readonly<Record<string, string>>;
  /**
   * The absolute path to import a Migration script from. Throws a RegistryError for a script the
   * version does not ship, or when the Registry is not on disk.
   */
  migrationScript(script: string): string;
}

/**
 * An opened Registry. The index and current Catalog are read and verified by
 * {@link openRegistry}; other Catalogs and every Module version are fetched and verified on
 * first use.
 */
export interface Registry {
  readonly name: string;
  readonly source: RegistrySource;
  readonly index: RegistryIndex;
  /** The current Release, whose Catalog is `currentCatalog`. */
  readonly release: string;
  readonly currentCatalog: ReleaseCatalog;
  /** Every published Release, sorted. */
  releases(): string[];
  /** The Catalog of a published Release, or `undefined` when the Registry never published it. */
  catalog(release: string): Promise<ReleaseCatalog | undefined>;
  /** Every published version of a Module in ascending semver order; empty for an unknown Module. */
  versions(name: string): string[];
  /** Like `versions`, without Yanked versions: the ones `add`, `create` and `update` may select. */
  selectableVersions(name: string): string[];
  /** A published Module version; throws `REGISTRY_MODULE_NOT_FOUND` when the index lacks it. */
  version(name: string, version: string): Promise<ModuleVersion>;
}

/**
 * What {@link openRegistry} needs besides the source.
 */
export interface OpenRegistryContext {
  /** Version of the running CLI, compared against the index `minCliVersion`. */
  cliVersion: string;
  /** The `fetch` a URL Registry is read with; native `fetch` by default. */
  fetch?: typeof fetch;
  /** Where Module versions fetched from a URL or `github:` Registry are kept between runs. */
  cache?: RegistryCache;
  /** The adapters a `github:` source is pinned and read with; the real ones by default. */
  github?: GithubAdapters;
  /** The user config a Namespace resolves through; read from `env` when a Namespace needs it. */
  userConfig?: UserConfig;
  /**
   * The environment `${VAR}` placeholders expand from and the user config is found by;
   * `process.env` by default.
   */
  env?: Readonly<Record<string, string | undefined>>;
  /** The Project directory whose `.env` underlies `env` for Namespace placeholders; none by default. */
  projectDir?: string;
  /**
   * Module `name@version` to the integrity the Lockfile records, for a shadcn Registry: those
   * versions are listed by `versions` and served from the integrity cache once upstream moved on.
   */
  pinned?: ReadonlyMap<string, string>;
  /**
   * The shadcn items to read at open instead of every item `registry.json` lists (a Namespace
   * lists none); a failure reading one of them fails the open.
   */
  items?: readonly string[];
  /**
   * The full commit SHA a shadcn Registry read from a git source is pinned to; its Adapted Modules
   * are then versioned from it instead of from the item JSON.
   */
  sourceSha?: string;
}

/**
 * How a `github:` source reaches GitHub: `lsRemote` resolves a ref to a commit SHA and
 * `rawBaseUrl` serves raw files as `<rawBaseUrl>/<owner>/<repo>/<sha>/<path>`.
 */
interface GithubAdapters {
  lsRemote?: GitLsRemote;
  rawBaseUrl?: string;
}

export type VersionEntry = RegistryIndex["modules"][string]["versions"][string];

export const rebuildFix = "Rebuild the Registry with `bun run registry:build`.";
export const verifyFix =
  "The Registry artifact changed after it was built. Rebuild it (`bun run registry:build`), restore it from version control, or ask the Registry owner to republish it.";

export function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Awaits every promise and, when some reject, rethrows the rejection of the earliest one in input
 * order, so the reported error does not depend on I/O timing.
 */
export async function allInOrder<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(promises);
  const values: T[] = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      throw result.reason;
    }
    values.push(result.value);
  }
  return values;
}

export function parseJson(text: string, onInvalid: (reason: string) => RegistryError): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw onInvalid(error instanceof Error ? error.message : String(error));
  }
}

export function verifyIntegrity(
  actual: Integrity,
  expected: Integrity,
  subject: string,
  data: { registry: string; module?: string; path?: string },
): void {
  if (actual !== expected) {
    throw new RegistryError(
      "REGISTRY_INTEGRITY_MISMATCH",
      `${subject} failed its integrity check: expected ${expected}, actual ${actual}.`,
      verifyFix,
      { ...data, expected, actual },
    );
  }
}
