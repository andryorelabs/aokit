import { z } from "zod";
import {
  catalogSchema,
  ManifestError,
  type ModuleManifest,
  parseManifest,
  stableStringify,
} from "@aokit/module";
import { loadUserConfig, type UserConfig } from "../config/user-config.ts";
import { createRegistryCache } from "./cache.ts";
import { RegistryError } from "./errors.ts";
import {
  type GitLsRemote,
  gitLsRemote,
  githubRawBaseUrl,
  githubTransport,
  pinnedGithubSource,
  resolveGithubPin,
} from "./github.ts";
import { computeIntegrity, computeModuleIntegrity, type Integrity } from "./integrity.ts";
import {
  assertSafeRelativePath,
  localTransport,
  type RegistryTransport,
  urlTransport,
} from "./remote.ts";
import { expandNamespaceRequest, loadNamespaceEnvironment, resolveNamespace } from "./namespace.ts";
import {
  catalogFileSchema,
  type ReleaseCatalog,
  type RegistryIndex,
  registryIndexSchema,
  registryIndexSchemaUrl,
  releaseModulesSchema,
  supportedRegistrySchemaVersion,
} from "./schema.ts";
import { type AdaptedModule, adaptShadcnItem } from "./shadcn/adapt.ts";
import { shadcnItemSchema, shadcnRegistrySchema } from "./shadcn/schema.ts";
import type { RegistrySource } from "./source.ts";

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
interface OpenRegistryContext {
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
}

/**
 * How a `github:` source reaches GitHub: `lsRemote` resolves a ref to a commit SHA and
 * `rawBaseUrl` serves raw files as `<rawBaseUrl>/<owner>/<repo>/<sha>/<path>`.
 */
interface GithubAdapters {
  lsRemote?: GitLsRemote;
  rawBaseUrl?: string;
}

type VersionEntry = RegistryIndex["modules"][string]["versions"][string];

const renamesFile = "renames.json";
const renamesSchema = z.record(z.string().min(1), z.string().min(1));
const rebuildFix = "Rebuild the Registry with `bun run registry:build`.";
const verifyFix =
  "The Registry artifact changed after it was built. Rebuild it (`bun run registry:build`), restore it from version control, or ask the Registry owner to republish it.";

const indexPathsShape = z.looseObject({
  releases: z.record(z.string(), z.looseObject({ path: z.unknown() })).optional(),
  modules: z
    .record(
      z.string(),
      z.looseObject({
        versions: z
          .record(
            z.string(),
            z.looseObject({
              manifest: z.unknown(),
              files: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Awaits every promise and, when some reject, rethrows the rejection of the earliest one in input
 * order, so the reported error does not depend on I/O timing.
 */
async function allInOrder<T>(promises: readonly Promise<T>[]): Promise<T[]> {
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

function parseJson(text: string, onInvalid: (reason: string) => RegistryError): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw onInvalid(error instanceof Error ? error.message : String(error));
  }
}

/**
 * The transport a source is read with, and the source the opened Registry reports: for `github:`
 * that is the Pin, `github:owner/repo#<sha40>`, so the Lockfile never records a moving ref.
 */
async function transportFor(
  source: Exclude<RegistrySource, { kind: "shadcn" }>,
  context: OpenRegistryContext,
): Promise<{ transport: RegistryTransport; source: RegistrySource }> {
  const fetchImpl = context.fetch ?? fetch;
  if (source.kind === "url") {
    return { transport: urlTransport(source.url, fetchImpl), source };
  }
  if (source.kind === "github") {
    const pin = await resolveGithubPin(source, {
      lsRemote: context.github?.lsRemote ?? gitLsRemote,
    });
    return {
      transport: githubTransport(pin, context.github?.rawBaseUrl ?? githubRawBaseUrl, fetchImpl),
      source: pinnedGithubSource(pin),
    };
  }
  return { transport: localTransport(source.path), source };
}

/**
 * Rejects every index path that is absolute or escapes its directory, on the raw index, so a
 * hostile path is refused before the schema is applied and before any fetch.
 */
function assertIndexPathsSafe(raw: unknown, location: string): void {
  const parsed = indexPathsShape.safeParse(raw);
  if (!parsed.success) {
    return;
  }
  for (const [release, pointer] of Object.entries(parsed.data.releases ?? {})) {
    if (typeof pointer.path === "string") {
      assertSafeRelativePath(pointer.path, `Registry index release ${release}`, location);
    }
  }
  for (const [name, moduleEntry] of Object.entries(parsed.data.modules ?? {})) {
    for (const [version, entry] of Object.entries(moduleEntry.versions ?? {})) {
      const subject = `Registry index Module ${name}@${version}`;
      if (typeof entry.manifest === "string") {
        assertSafeRelativePath(entry.manifest, subject, location);
        const moduleDirectory = `modules/${name}/${version}/`;
        if (!entry.manifest.startsWith(moduleDirectory)) {
          throw new RegistryError(
            "REGISTRY_PATH_UNSAFE",
            `${subject} lists the manifest "${entry.manifest}", which is outside ${moduleDirectory}.`,
            "The Registry index is malformed or hostile. Do not use it; rebuild it with `bun run registry:build`.",
            { registry: location, module: `${name}@${version}`, path: entry.manifest },
          );
        }
      }
      for (const path of Object.keys(entry.files ?? {})) {
        assertSafeRelativePath(path, subject, location);
      }
    }
  }
}

function parseIndex(transport: RegistryTransport, text: string | undefined): RegistryIndex {
  const location = `${transport.location}/index.json`;
  if (text === undefined) {
    throw new RegistryError(
      "REGISTRY_NOT_FOUND",
      `No Registry index at ${location}.`,
      "Point --registry at a Registry that serves index.json, or run `bun run registry:build`.",
      { registry: transport.location, path: location },
    );
  }
  const raw = parseJson(
    text,
    (reason) =>
      new RegistryError(
        "REGISTRY_INDEX_INVALID",
        `Registry index ${location} is not valid JSON: ${reason}`,
        rebuildFix,
        { registry: transport.location, path: location },
      ),
  );
  const schemaVersion =
    typeof raw === "object" && raw !== null && "schemaVersion" in raw
      ? raw.schemaVersion
      : undefined;
  if (typeof schemaVersion === "number" && schemaVersion > supportedRegistrySchemaVersion) {
    throw new RegistryError(
      "REGISTRY_SCHEMA_TOO_NEW",
      `Registry index ${location} has schemaVersion ${schemaVersion}: expected <= ${supportedRegistrySchemaVersion}, actual ${schemaVersion}.`,
      "Update the aokit CLI to read this Registry.",
      {
        registry: transport.location,
        expected: `<= ${supportedRegistrySchemaVersion}`,
        actual: String(schemaVersion),
      },
    );
  }
  assertIndexPathsSafe(raw, transport.location);
  const parsed = registryIndexSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new RegistryError(
      "REGISTRY_INDEX_INVALID",
      `Registry index ${location} is invalid: ${issues}`,
      rebuildFix,
      { registry: transport.location, path: location },
    );
  }
  return parsed.data;
}

function checkCliVersion(index: RegistryIndex, cliVersion: string): void {
  if (Bun.semver.order(cliVersion, index.minCliVersion) < 0) {
    throw new RegistryError(
      "REGISTRY_CLI_TOO_OLD",
      `Registry "${index.name}" release ${index.release} requires CLI ${index.minCliVersion} or newer: expected >= ${index.minCliVersion}, actual ${cliVersion}.`,
      `Update the aokit CLI to ${index.minCliVersion} or newer, then run the command again.`,
      { registry: index.name, expected: `>= ${index.minCliVersion}`, actual: cliVersion },
    );
  }
}

function verifyIntegrity(
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

async function readCatalog(
  transport: RegistryTransport,
  registryName: string,
  release: string,
  pointer: RegistryIndex["releases"][string],
): Promise<ReleaseCatalog> {
  const subject = `Registry "${registryName}" Catalog ${pointer.path}`;
  const text = await transport.read(pointer.path);
  if (text === undefined) {
    throw new RegistryError("REGISTRY_FILE_MISSING", `${subject} is missing.`, rebuildFix, {
      registry: registryName,
      path: pointer.path,
    });
  }
  verifyIntegrity(computeIntegrity(text), pointer.integrity, subject, {
    registry: registryName,
    path: pointer.path,
  });
  const invalid = (reason: string) =>
    new RegistryError(
      "REGISTRY_CATALOG_INVALID",
      `${subject} is invalid: ${reason}`,
      "Fix the Catalog source and rebuild the Registry.",
      { registry: registryName, path: pointer.path },
    );
  const file = catalogFileSchema.safeParse(parseJson(text, invalid));
  const { modules: rawModules, ...rawCatalog } = file.success ? file.data : {};
  const parsed = catalogSchema.safeParse(rawCatalog);
  const parsedModules = releaseModulesSchema.safeParse(rawModules);
  if (!parsed.success || !parsedModules.success) {
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues),
      ...(parsedModules.success
        ? []
        : parsedModules.error.issues.map((issue) => ({
            ...issue,
            message: `modules: ${issue.message}`,
          }))),
    ];
    throw invalid(issues.map((issue) => issue.message).join("; "));
  }
  if (parsed.data.release !== release) {
    throw new RegistryError(
      "REGISTRY_RELEASE_MISMATCH",
      `${subject} belongs to another Release: expected ${release}, actual ${parsed.data.release ?? "(none)"}.`,
      `Point the index release ${release} at catalog/${release}.json, or set its "release" to ${release}, then rebuild.`,
      { registry: registryName, expected: release, actual: parsed.data.release ?? "(none)" },
    );
  }
  return { ...parsed.data, modules: parsedModules.data };
}

/**
 * Checks fetched (or cached) Module content against the index: every file's own integrity, then
 * the Module integrity over the manifest and all files.
 */
function verifyModuleContent(
  content: CachedModuleVersion,
  entry: VersionEntry,
  subject: string,
  data: { registry: string; module: string },
): void {
  const expectedPaths = Object.keys(entry.files).toSorted(byCodepoint);
  const actualPaths = [...content.files.keys()].toSorted(byCodepoint);
  if (expectedPaths.join("\0") !== actualPaths.join("\0")) {
    throw new RegistryError(
      "REGISTRY_INTEGRITY_MISMATCH",
      `${subject} holds other files than the index records: expected [${expectedPaths.join(", ")}], actual [${actualPaths.join(", ")}].`,
      verifyFix,
      { ...data, expected: expectedPaths.join(","), actual: actualPaths.join(",") },
    );
  }
  for (const path of expectedPaths) {
    const expected = entry.files[path];
    if (expected !== undefined) {
      verifyIntegrity(
        computeIntegrity(content.files.get(path) ?? ""),
        expected,
        `${subject} file ${path}`,
        {
          ...data,
          path,
        },
      );
    }
  }
  verifyIntegrity(
    computeModuleIntegrity(content.manifest, content.files),
    entry.integrity,
    subject,
    data,
  );
}

async function fetchModuleContent(
  transport: RegistryTransport,
  name: string,
  version: string,
  entry: VersionEntry,
  subject: string,
  registryName: string,
): Promise<CachedModuleVersion> {
  const moduleDirectory = `modules/${name}/${version}`;
  const missing = (what: string, path: string): RegistryError =>
    new RegistryError("REGISTRY_FILE_MISSING", `${subject} ${what} is missing.`, rebuildFix, {
      registry: registryName,
      module: `${name}@${version}`,
      path,
    });
  const paths = Object.keys(entry.files).toSorted(byCodepoint);
  const [manifest, ...texts] = await allInOrder([
    transport.read(entry.manifest),
    ...paths.map((path) => transport.read(`${moduleDirectory}/${path}`)),
  ]);
  if (manifest === undefined) {
    throw missing(`manifest ${entry.manifest}`, entry.manifest);
  }
  const files = new Map<string, string>();
  for (const [position, path] of paths.entries()) {
    const text = texts[position];
    if (text === undefined) {
      throw missing(`file ${path}`, path);
    }
    files.set(path, text);
  }
  return { manifest, files };
}

async function readVerifiedContent(
  transport: RegistryTransport,
  cache: RegistryCache | undefined,
  name: string,
  version: string,
  entry: VersionEntry,
  registryName: string,
): Promise<CachedModuleVersion> {
  const subject = `Registry "${registryName}" Module ${name}@${version}`;
  const data = { registry: registryName, module: `${name}@${version}` };
  const cached = await cache?.get(entry.integrity).catch(() => undefined);
  if (cached !== undefined) {
    try {
      verifyModuleContent(cached, entry, subject, data);
      return cached;
    } catch (error) {
      if (!(error instanceof RegistryError && error.code === "REGISTRY_INTEGRITY_MISMATCH")) {
        throw error;
      }
    }
  }
  const fetched = await fetchModuleContent(transport, name, version, entry, subject, registryName);
  verifyModuleContent(fetched, entry, subject, data);
  await cache?.put(entry.integrity, fetched).catch(() => undefined);
  return fetched;
}

function parseModuleManifest(
  manifestText: string,
  subject: string,
  registryName: string,
): ModuleManifest {
  const invalid = (reason: string, fix: string) =>
    new RegistryError(
      "REGISTRY_MANIFEST_INVALID",
      `${subject} manifest is invalid: ${reason}`,
      fix,
      {
        registry: registryName,
      },
    );
  const raw = parseJson(manifestText, (reason) =>
    invalid(reason, "Fix the Module source and rebuild the Registry."),
  );
  try {
    return parseManifest(raw);
  } catch (error) {
    if (error instanceof ManifestError) {
      throw invalid(
        error.message,
        error.code === "manifest_schema_too_new"
          ? "Update the aokit CLI to read this Module."
          : "Fix the Module source and rebuild the Registry.",
      );
    }
    throw error;
  }
}

function checkManifestMatchesEntry(
  subject: string,
  registryName: string,
  name: string,
  version: string,
  manifest: ModuleManifest,
  entry: VersionEntry,
): void {
  const mismatch = (field: string, expected: string, actual: string): RegistryError =>
    new RegistryError(
      "REGISTRY_SUMMARY_MISMATCH",
      `${subject} manifest disagrees with the index on ${field}: expected ${expected}, actual ${actual}.`,
      rebuildFix,
      { registry: registryName, module: `${name}@${version}`, expected, actual },
    );
  if (manifest.name !== name) {
    throw mismatch("name", name, manifest.name);
  }
  if (manifest.version !== version) {
    throw mismatch("version", version, manifest.version);
  }
  if (manifest.schemaVersion !== entry.schemaVersion) {
    throw mismatch("schemaVersion", String(entry.schemaVersion), String(manifest.schemaVersion));
  }
  const provides = manifest.provides.map((provided) => provided.capability);
  if (provides.join(",") !== entry.provides.join(",")) {
    throw mismatch("provides", `[${entry.provides.join(", ")}]`, `[${provides.join(", ")}]`);
  }
}

function checkManifestFiles(
  subject: string,
  registryName: string,
  manifest: ModuleManifest,
  files: ReadonlyMap<string, string>,
): void {
  const unrecorded = (what: string, path: string, fix: string): RegistryError =>
    new RegistryError(
      "REGISTRY_FILE_MISSING",
      `${subject} manifest lists ${what}${path}, which the index does not record.`,
      fix,
      { registry: registryName, path },
    );
  for (const file of manifest.files) {
    if (!files.has(file.from)) {
      throw unrecorded(
        "",
        file.from,
        "Add the file under the Module's files/ directory and rebuild the Registry.",
      );
    }
  }
  for (const migration of manifest.migrations) {
    if (!files.has(migration.script)) {
      throw unrecorded(
        "migration script ",
        migration.script,
        "Add the script under the Module's migrations/ directory and rebuild the Registry.",
      );
    }
  }
}

function parseRenames(
  files: ReadonlyMap<string, string>,
  subject: string,
  registryName: string,
): Readonly<Record<string, string>> {
  const text = files.get(renamesFile);
  if (text === undefined) {
    return {};
  }
  const invalid = (reason: string) =>
    new RegistryError(
      "REGISTRY_MANIFEST_INVALID",
      `${subject} ${renamesFile} is invalid: ${reason}`,
      "Make renames.json an object of old path to new path and rebuild the Registry.",
      { registry: registryName, path: renamesFile },
    );
  const parsed = renamesSchema.safeParse(parseJson(text, invalid));
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}

async function loadModuleVersion(
  transport: RegistryTransport,
  cache: RegistryCache | undefined,
  index: RegistryIndex,
  name: string,
  version: string,
  entry: VersionEntry,
): Promise<ModuleVersion> {
  const subject = `Registry "${index.name}" Module ${name}@${version}`;
  const content = await readVerifiedContent(transport, cache, name, version, entry, index.name);
  const manifest = parseModuleManifest(content.manifest, subject, index.name);
  checkManifestMatchesEntry(subject, index.name, name, version, manifest, entry);
  checkManifestFiles(subject, index.name, manifest, content.files);
  const files = new Map(content.files);
  return {
    name,
    version,
    manifest,
    files,
    integrity: entry.integrity,
    renames: parseRenames(files, subject, index.name),
    migrationScript: (script) => {
      if (!files.has(script)) {
        throw new RegistryError(
          "REGISTRY_FILE_MISSING",
          `${subject} does not ship ${script}.`,
          rebuildFix,
          {
            registry: index.name,
            module: `${name}@${version}`,
            path: script,
          },
        );
      }
      if (transport.localPath === undefined) {
        throw new RegistryError(
          "REGISTRY_SOURCE_UNSUPPORTED",
          `${subject} is not on disk, so its Migration script ${script} cannot be imported.`,
          "Run the Migration from a local copy of the Registry.",
          { registry: index.name, module: `${name}@${version}`, path: script },
        );
      }
      return transport.localPath(`modules/${name}/${version}/${script}`);
    },
  };
}

const shadcnIndexFile = "registry.json";
const shadcnRelease = "shadcn";
const shadcnMinCliVersion = "0.0.0";
const scopePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const namespaceProbeItem = "aokit-item-name";
const itemChangedFix = "Run `aokit update` to move it to the version the Registry serves now.";

type TemplateEnvironment = Readonly<Record<string, string | undefined>>;

/** Every `${VAR}` reads as set, so a Namespace resolves without expanding or checking anything. */
const permissiveEnvironment: TemplateEnvironment = new Proxy(
  {},
  { get: () => "", has: () => true },
);

/** How one shadcn item is fetched: the transport that serves it and the path it is read at. */
interface ItemLocation {
  readonly transport: RegistryTransport;
  readonly path: string;
}

/** The outcome of reading one shadcn item at open: adapted, absent upstream, or failed. */
type ItemRead =
  | { readonly kind: "served"; readonly module: AdaptedModule }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly error: unknown };

/** A Namespace as the user config (or the Lockfile) declares it, placeholders kept. */
interface NamespaceDeclaration {
  readonly template: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What `registry.json` tells: the declared name and the item names. */
interface ShadcnIndex {
  readonly name?: string;
  readonly items: readonly string[];
}

type ShadcnSource = Extract<RegistrySource, { kind: "shadcn" }>;

function asIntegrity(value: string | undefined): Integrity | undefined {
  return value !== undefined && isIntegrity(value) ? value : undefined;
}

function isIntegrity(value: string): value is Integrity {
  return /^sha256-[0-9a-f]{64}$/.test(value);
}

function isOffline(error: unknown): boolean {
  return (
    error instanceof RegistryError &&
    error.code === "REGISTRY_FETCH_FAILED" &&
    error.data.status === undefined
  );
}

function hostScope(url: string): string {
  const slug = new URL(url).hostname
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `r-${slug}`;
}

function scopeOf(moduleName: string): string | undefined {
  return /^@([^/]+)\//.exec(moduleName)?.[1];
}

/** Splits a `name@version` key of the Lockfile into Module name and version. */
function splitModuleKey(key: string): { name: string; version: string } | undefined {
  const at = key.lastIndexOf("@");
  return at <= 0 ? undefined : { name: key.slice(0, at), version: key.slice(at + 1) };
}

/**
 * The template and headers of a Namespace: the user config entry (or the built-in one), else the
 * template the Lockfile recorded, sent without headers. Nothing is expanded here.
 */
function declareNamespace(
  namespace: string,
  recordedTemplate: string,
  userConfig: UserConfig,
): NamespaceDeclaration {
  try {
    const target = resolveNamespace(
      `${namespace}/${namespaceProbeItem}`,
      userConfig,
      permissiveEnvironment,
    );
    return {
      template: target.urlTemplate.replaceAll(namespaceProbeItem, "{name}"),
      headers: target.headers,
    };
  } catch (error) {
    if (
      error instanceof RegistryError &&
      error.code === "REGISTRY_NOT_FOUND" &&
      recordedTemplate !== ""
    ) {
      return { template: recordedTemplate, headers: {} };
    }
    throw error;
  }
}

function splitParent(url: string): { base: string; file: string } {
  const cut = url.lastIndexOf("/");
  return { base: url.slice(0, cut), file: url.slice(cut + 1) };
}

/** Where a Namespace item is read: its expanded URL, with headers only for the Namespace origin. */
function namespaceItemLocation(
  namespace: string,
  declaration: NamespaceDeclaration,
  item: string,
  env: TemplateEnvironment,
  fetchImpl: typeof fetch,
): ItemLocation {
  const urlTemplate = declaration.template.replaceAll("{name}", encodeURIComponent(item));
  const request = expandNamespaceRequest(
    { namespace, item, urlTemplate, headers: { ...declaration.headers } },
    env,
  );
  const expanded = splitParent(request.url);
  return {
    transport: urlTransport(expanded.base, fetchImpl, {
      headers: request.headers,
      displayBase: splitParent(urlTemplate).base,
    }),
    path: decodeURIComponent(expanded.file),
  };
}

function shadcnIndexInvalid(location: string, reason: string): RegistryError {
  return new RegistryError(
    "REGISTRY_INDEX_INVALID",
    `shadcn Registry index ${location} is invalid: ${reason}`,
    "Point --registry at a shadcn Registry that serves a valid registry.json.",
    { registry: location, path: location },
  );
}

function parseShadcnIndex(text: string, location: string): ShadcnIndex {
  const parsed = shadcnRegistrySchema.safeParse(
    parseJson(text, (reason) => shadcnIndexInvalid(location, reason)),
  );
  if (!parsed.success) {
    throw shadcnIndexInvalid(
      location,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }
  return {
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
    items: parsed.data.items.map((item) => item.name),
  };
}

/** Reads `registry.json`; `undefined` when the network is unreachable, so a warm cache serves. */
async function readShadcnIndex(
  transport: RegistryTransport,
  preRead: string | undefined,
): Promise<{ index: ShadcnIndex; text: string } | undefined> {
  const location = `${transport.location}/${shadcnIndexFile}`;
  let text = preRead;
  if (text === undefined) {
    try {
      text = await transport.read(shadcnIndexFile);
    } catch (error) {
      if (isOffline(error)) return undefined;
      throw error;
    }
  }
  if (text === undefined) {
    throw new RegistryError(
      "REGISTRY_NOT_FOUND",
      `No shadcn Registry index at ${location}.`,
      "Point --registry at a shadcn Registry that serves registry.json.",
      { registry: transport.location, path: location },
    );
  }
  return { index: parseShadcnIndex(text, location), text };
}

async function readItem(
  location: ItemLocation,
  item: string,
  registryName: string,
): Promise<ItemRead> {
  const text = await location.transport.read(location.path);
  if (text === undefined) {
    return { kind: "missing" };
  }
  const subject = `Registry "${registryName}" shadcn item ${item}`;
  const invalid = (reason: string): RegistryError =>
    new RegistryError(
      "REGISTRY_MANIFEST_INVALID",
      `${subject} is invalid: ${reason}`,
      "Report the item to its Registry maintainer.",
      { registry: registryName, module: item },
    );
  const parsed = shadcnItemSchema.safeParse(parseJson(text, invalid));
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  if (parsed.data.name !== item) {
    throw new RegistryError(
      "REGISTRY_SUMMARY_MISMATCH",
      `${subject} is named differently: expected ${item}, actual ${parsed.data.name}.`,
      "Report the item to its Registry maintainer.",
      { registry: registryName, module: item, expected: item, actual: parsed.data.name },
    );
  }
  try {
    return { kind: "served", module: adaptShadcnItem(parsed.data, { scope: registryName }) };
  } catch (error) {
    if (error instanceof RegistryError) {
      throw new RegistryError(error.code, error.message, error.fix, {
        ...error.data,
        registry: registryName,
      });
    }
    throw error;
  }
}

function cachedContent(module: AdaptedModule): CachedModuleVersion {
  return { manifest: stableStringify(module.manifest), files: module.files };
}

function adaptedModuleVersion(
  name: string,
  version: string,
  manifest: ModuleManifest,
  files: ReadonlyMap<string, string>,
  integrity: Integrity,
  registryName: string,
): ModuleVersion {
  return {
    name,
    version,
    manifest,
    files: new Map(files),
    integrity,
    renames: {},
    migrationScript: (script) => {
      throw new RegistryError(
        "REGISTRY_FILE_MISSING",
        `Adapted Module ${name}@${version} of Registry "${registryName}" ships no Migration script ${script}.`,
        "Adapted Modules are declarative; they carry no Migration.",
        { registry: registryName, module: `${name}@${version}`, path: script },
      );
    },
  };
}

/**
 * A cache hit for a recorded integrity, verified again: the integrity over its content, a valid
 * declarative manifest of the same name and version, and every file the manifest lists. Anything
 * else is ignored, as a miss.
 */
async function readCachedAdapted(
  cache: RegistryCache,
  recorded: Integrity,
  name: string,
  version: string,
  registryName: string,
): Promise<ModuleVersion | undefined> {
  const cached = await cache.get(recorded).catch(() => undefined);
  if (cached === undefined || computeModuleIntegrity(cached.manifest, cached.files) !== recorded) {
    return undefined;
  }
  let manifest: ModuleManifest;
  try {
    manifest = parseModuleManifest(cached.manifest, `Adapted Module ${name}`, registryName);
  } catch {
    return undefined;
  }
  const declarative =
    manifest.name === name &&
    manifest.version === version &&
    manifest.migrations.length === 0 &&
    manifest.files.every((file) => cached.files.has(file.from));
  return declarative
    ? adaptedModuleVersion(name, version, manifest, cached.files, recorded, registryName)
    : undefined;
}

function syntheticIndex(
  registryName: string,
  indexText: string,
  served: ReadonlyMap<string, AdaptedModule>,
): RegistryIndex {
  const modules: RegistryIndex["modules"] = {};
  for (const [moduleName, module] of [...served].toSorted(([left], [right]) =>
    byCodepoint(left, right),
  )) {
    modules[moduleName] = {
      latest: module.version,
      versions: {
        [module.version]: {
          manifest: shadcnIndexFile,
          integrity: module.integrity,
          schemaVersion: module.manifest.schemaVersion,
          provides: module.manifest.provides.map((provided) => provided.capability),
          files: Object.fromEntries(
            [...module.files].map(([path, text]) => [path, computeIntegrity(text)]),
          ),
        },
      },
    };
  }
  return {
    $schema: registryIndexSchemaUrl,
    schemaVersion: supportedRegistrySchemaVersion,
    name: registryName,
    release: shadcnRelease,
    minCliVersion: shadcnMinCliVersion,
    releases: {
      [shadcnRelease]: { path: shadcnIndexFile, integrity: computeIntegrity(indexText) },
    },
    modules,
  };
}

async function namespaceEnvironment(context: OpenRegistryContext): Promise<TemplateEnvironment> {
  const env = context.env ?? process.env;
  return context.projectDir === undefined
    ? env
    : await loadNamespaceEnvironment(context.projectDir, env);
}

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
async function openShadcnRegistry(
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
        return await readItem(origin.locate(item), item, registryName);
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

/**
 * Opens a Registry from any source behind one lazy interface. A URL source serving no `index.json`
 * but a `registry.json` is a shadcn Registry, opened as {@link openShadcnRegistry} describes, as is
 * every `shadcn` source; a shadcn Registry never reaches the index path below. It reads `index.json`, refuses an
 * unknown `schemaVersion`, a `minCliVersion` above `cliVersion` and any index path that is
 * absolute or escapes its directory, then reads and verifies the current Catalog. Nothing else is
 * read until a caller asks for it; every Module version is integrity-checked on each read, from
 * `cache` or from the source.
 */
export async function openRegistry(
  source: RegistrySource,
  context: OpenRegistryContext,
): Promise<Registry> {
  if (source.kind === "shadcn") {
    return openShadcnRegistry(source, context);
  }
  const opened = await transportFor(source, context);
  const { transport } = opened;
  const cache = source.kind === "url" || source.kind === "github" ? context.cache : undefined;
  const indexText = await transport.read("index.json");
  if (indexText === undefined && source.kind === "url") {
    const shadcnIndexText = await transport.read(shadcnIndexFile);
    if (shadcnIndexText !== undefined) {
      return openShadcnRegistry({ kind: "shadcn", url: source.url }, context, shadcnIndexText);
    }
  }
  const index = parseIndex(transport, indexText);
  checkCliVersion(index, context.cliVersion);
  const currentPointer = index.releases[index.release];
  if (currentPointer === undefined) {
    throw new RegistryError(
      "REGISTRY_CATALOG_INVALID",
      `Registry "${index.name}" has no Catalog for its current Release ${index.release}.`,
      rebuildFix,
      { registry: index.name },
    );
  }
  const currentCatalog = await readCatalog(transport, index.name, index.release, currentPointer);
  const catalogs = new Map<string, Promise<ReleaseCatalog>>([
    [index.release, Promise.resolve(currentCatalog)],
  ]);
  const loadedVersions = new Map<string, Promise<ModuleVersion>>();
  const versions = (name: string): string[] =>
    Object.keys(index.modules[name]?.versions ?? {}).toSorted((left, right) =>
      Bun.semver.order(left, right),
    );
  const selectableVersions = (name: string): string[] =>
    versions(name).filter((version) => index.modules[name]?.versions[version]?.yanked !== true);
  return {
    name: index.name,
    source: opened.source,
    index,
    selectableVersions,
    release: index.release,
    currentCatalog,
    releases: () => Object.keys(index.releases).toSorted(byCodepoint),
    catalog(release) {
      const pointer = index.releases[release];
      if (pointer === undefined) {
        return Promise.resolve(undefined);
      }
      const known = catalogs.get(release);
      if (known !== undefined) {
        return known;
      }
      const loading = readCatalog(transport, index.name, release, pointer);
      catalogs.set(release, loading);
      loading.catch(() => catalogs.delete(release));
      return loading;
    },
    versions,
    version(name, version) {
      const entry = index.modules[name]?.versions[version];
      if (entry === undefined) {
        return Promise.reject(
          new RegistryError(
            "REGISTRY_MODULE_NOT_FOUND",
            `Registry "${index.name}" does not publish ${name}@${version}.`,
            `Pick one of the published versions: ${versions(name).join(", ") || "(none)"}.`,
            { registry: index.name, module: `${name}@${version}` },
          ),
        );
      }
      const key = `${name}@${version}`;
      const known = loadedVersions.get(key);
      if (known !== undefined) {
        return known;
      }
      const loading = loadModuleVersion(transport, cache, index, name, version, entry);
      loadedVersions.set(key, loading);
      loading.catch(() => loadedVersions.delete(key));
      return loading;
    },
  };
}
