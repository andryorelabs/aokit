import { z } from "zod";
import { catalogSchema, ManifestError, type ModuleManifest, parseManifest } from "@aokit/module";
import { RegistryError } from "./errors.ts";
import { computeIntegrity, computeModuleIntegrity, type Integrity } from "./integrity.ts";
import {
  assertSafeRelativePath,
  localTransport,
  type RegistryTransport,
  urlTransport,
} from "./remote.ts";
import {
  catalogFileSchema,
  type ReleaseCatalog,
  type RegistryIndex,
  registryIndexSchema,
  releaseModulesSchema,
  supportedRegistrySchemaVersion,
} from "./schema.ts";
import { formatRegistrySource, type RegistrySource } from "./source.ts";

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
  /** Where fetched Module versions are kept between runs. */
  cache?: RegistryCache;
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

function transportFor(source: RegistrySource, fetchImpl: typeof fetch): RegistryTransport {
  if (source.kind === "url") {
    return urlTransport(source.url, fetchImpl);
  }
  if (source.kind === "github") {
    throw new RegistryError(
      "REGISTRY_SOURCE_UNSUPPORTED",
      `Registry source "${formatRegistrySource(source)}" is a GitHub source, which this CLI cannot read yet.`,
      "Use a local path, an https:// URL or the bundled Registry.",
      { registry: formatRegistrySource(source) },
    );
  }
  return localTransport(source.path);
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

async function readIndex(transport: RegistryTransport): Promise<RegistryIndex> {
  const location = `${transport.location}/index.json`;
  const text = await transport.read("index.json");
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
  const cached = await cache?.get(entry.integrity);
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
  await cache?.put(entry.integrity, fetched);
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

/**
 * Opens a Registry from any source behind one lazy interface. It reads `index.json`, refuses an
 * unknown `schemaVersion`, a `minCliVersion` above `cliVersion` and any index path that is
 * absolute or escapes its directory, then reads and verifies the current Catalog. Nothing else is
 * read until a caller asks for it; every Module version is integrity-checked on each read, from
 * `cache` or from the source.
 */
export async function openRegistry(
  source: RegistrySource,
  context: OpenRegistryContext,
): Promise<Registry> {
  const transport = transportFor(source, context.fetch ?? fetch);
  const index = await readIndex(transport);
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
  return {
    name: index.name,
    source,
    index,
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
      const loading = loadModuleVersion(transport, context.cache, index, name, version, entry);
      loadedVersions.set(key, loading);
      loading.catch(() => loadedVersions.delete(key));
      return loading;
    },
  };
}
