import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  type Catalog,
  catalogSchema,
  ManifestError,
  type ModuleManifest,
  parseManifest,
} from "@aokit/module";
import { RegistryError } from "./errors.ts";
import {
  computeIntegrity,
  computeModuleIntegrity,
  type Integrity,
  normalizeLineEndings,
} from "./integrity.ts";
import {
  type RegistryIndex,
  registryIndexSchema,
  supportedRegistrySchemaVersion,
} from "./schema.ts";

/**
 * A verified Module version of a local Registry: its manifest, its files keyed by the path the
 * manifest's `files[].from` uses, and the Module integrity the index published for it.
 */
interface RegistryModule {
  manifest: ModuleManifest;
  files: Map<string, string>;
  integrity: Integrity;
  /**
   * The absolute path to import a Migration script from, for a `script` the manifest's
   * `migrations` lists. Throws a `RegistryError` for a path the version does not ship.
   */
  migrationScript(script: string): string;
  /**
   * The Renames manifest of this version (old path to new path, Target-relative, previous version
   * to this one); empty when the version ships no `renames.json`.
   */
  renames: Readonly<Record<string, string>>;
}

/**
 * A local Registry read from disk with every Module version, file and Catalog integrity-checked.
 * `modules` holds the `latest` version of each Module.
 */
export interface LocalRegistry {
  name: string;
  /** The current Release, whose Catalog is `currentCatalog`. */
  release: string;
  currentCatalog: Catalog;
  modules: Map<string, RegistryModule>;
  /** Every published Release, sorted. */
  releases(): string[];
  /** The Catalog of a published Release, or `undefined` when the Registry never published it. */
  catalog(release: string): Catalog | undefined;
  /** A published Module version, or `undefined` when the Registry does not hold it. */
  version(name: string, version: string): RegistryModule | undefined;
  /** Every published version of a Module in ascending semver order; empty for an unknown Module. */
  versions(name: string): string[];
}

/**
 * Options for {@link readLocalRegistry}.
 */
interface ReadLocalRegistryOptions {
  /** Version of the running CLI, compared against the index `minCliVersion`. */
  cliVersion: string;
}

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

const renamesFile = "renames.json";

const renamesSchema = z.record(z.string().min(1), z.string().min(1));

const verifyFix =
  "The Registry artifact was changed after it was built. Rebuild it (`bun run registry:build`) or restore it from version control.";

async function readText(path: string, onMissing: () => RegistryError): Promise<string> {
  try {
    return normalizeLineEndings(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw onMissing();
    }
    throw error;
  }
}

function parseJson(text: string, onInvalid: (reason: string) => RegistryError): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw onInvalid(error instanceof Error ? error.message : String(error));
  }
}

function verifyIntegrity(actual: Integrity, expected: Integrity, subject: string): void {
  if (actual !== expected) {
    throw new RegistryError(
      "REGISTRY_INTEGRITY_MISMATCH",
      `${subject} failed its integrity check: expected ${expected}, actual ${actual}.`,
      verifyFix,
    );
  }
}

function schemaVersionOf(raw: unknown): unknown {
  return typeof raw === "object" && raw !== null && "schemaVersion" in raw
    ? raw.schemaVersion
    : undefined;
}

function checkCliVersion(index: RegistryIndex, cliVersion: string): void {
  if (Bun.semver.order(cliVersion, index.minCliVersion) < 0) {
    throw new RegistryError(
      "REGISTRY_CLI_TOO_OLD",
      `Registry "${index.name}" release ${index.release} requires CLI ${index.minCliVersion} or newer: expected >= ${index.minCliVersion}, actual ${cliVersion}.`,
      `Update the aokit CLI to ${index.minCliVersion} or newer, then run the command again.`,
    );
  }
}

async function readIndex(root: string): Promise<RegistryIndex> {
  const indexPath = join(root, "index.json");
  const text = await readText(
    indexPath,
    () =>
      new RegistryError(
        "REGISTRY_NOT_FOUND",
        `No Registry index at ${indexPath}.`,
        "Point --registry at a directory that contains index.json, or run `bun run registry:build`.",
      ),
  );
  const raw = parseJson(
    text,
    (reason) =>
      new RegistryError(
        "REGISTRY_INDEX_INVALID",
        `Registry index ${indexPath} is not valid JSON: ${reason}`,
        "Rebuild the Registry with `bun run registry:build`.",
      ),
  );
  const schemaVersion = schemaVersionOf(raw);
  if (typeof schemaVersion === "number" && schemaVersion > supportedRegistrySchemaVersion) {
    throw new RegistryError(
      "REGISTRY_SCHEMA_TOO_NEW",
      `Registry index ${indexPath} has schemaVersion ${schemaVersion}: expected <= ${supportedRegistrySchemaVersion}, actual ${schemaVersion}.`,
      "Update the aokit CLI to read this Registry.",
    );
  }
  const parsed = registryIndexSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new RegistryError(
      "REGISTRY_INDEX_INVALID",
      `Registry index ${indexPath} is invalid: ${issues}`,
      "Rebuild the Registry with `bun run registry:build`.",
    );
  }
  return parsed.data;
}

async function readCatalog(
  root: string,
  registryName: string,
  release: string,
  pointer: RegistryIndex["releases"][string],
): Promise<Catalog> {
  const subject = `Registry "${registryName}" Catalog ${pointer.path}`;
  const text = await readText(
    join(root, pointer.path),
    () =>
      new RegistryError(
        "REGISTRY_FILE_MISSING",
        `${subject} is missing.`,
        "Rebuild the Registry with `bun run registry:build`.",
      ),
  );
  verifyIntegrity(computeIntegrity(text), pointer.integrity, subject);
  const parsed = catalogSchema.safeParse(
    parseJson(
      text,
      (reason) =>
        new RegistryError(
          "REGISTRY_CATALOG_INVALID",
          `${subject} is not valid JSON: ${reason}`,
          "Fix the Catalog source and rebuild the Registry.",
        ),
    ),
  );
  if (!parsed.success) {
    throw new RegistryError(
      "REGISTRY_CATALOG_INVALID",
      `${subject} is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      "Fix the Catalog source and rebuild the Registry.",
    );
  }
  if (parsed.data.release !== release) {
    throw new RegistryError(
      "REGISTRY_RELEASE_MISMATCH",
      `${subject} belongs to another Release: expected ${release}, actual ${parsed.data.release ?? "(none)"}.`,
      `Point the index release ${release} at catalog/${release}.json, or set its "release" to ${release}, then rebuild.`,
    );
  }
  return parsed.data;
}

function checkManifestMatchesEntry(
  registryName: string,
  name: string,
  version: string,
  manifest: ModuleManifest,
  entry: RegistryIndex["modules"][string]["versions"][string],
): void {
  const subject = `Registry "${registryName}" Module ${name}@${version}`;
  const mismatch = (field: string, expected: string, actual: string): RegistryError =>
    new RegistryError(
      "REGISTRY_SUMMARY_MISMATCH",
      `${subject} manifest disagrees with the index on ${field}: expected ${expected}, actual ${actual}.`,
      "Rebuild the Registry with `bun run registry:build`.",
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

function parseRenames(
  files: ReadonlyMap<string, string>,
  subject: string,
): Readonly<Record<string, string>> {
  const text = files.get(renamesFile);
  if (text === undefined) {
    return {};
  }
  const parsed = renamesSchema.safeParse(
    parseJson(
      text,
      (reason) =>
        new RegistryError(
          "REGISTRY_MANIFEST_INVALID",
          `${subject} ${renamesFile} is not valid JSON: ${reason}`,
          "Fix the Module source and rebuild the Registry.",
        ),
    ),
  );
  if (!parsed.success) {
    throw new RegistryError(
      "REGISTRY_MANIFEST_INVALID",
      `${subject} ${renamesFile} is invalid: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      "Make renames.json an object of old path to new path and rebuild the Registry.",
    );
  }
  return parsed.data;
}

async function readModuleVersion(
  root: string,
  registryName: string,
  name: string,
  version: string,
  entry: RegistryIndex["modules"][string]["versions"][string],
): Promise<RegistryModule> {
  const subject = `Registry "${registryName}" Module ${name}@${version}`;
  const missing = (what: string) => () =>
    new RegistryError(
      "REGISTRY_FILE_MISSING",
      `${subject} ${what} is missing.`,
      "Rebuild the Registry with `bun run registry:build`.",
    );
  const manifestText = await readText(
    join(root, entry.manifest),
    missing(`manifest ${entry.manifest}`),
  );
  const fileRoot = join(root, "modules", name, version);
  const fileEntries = Object.entries(entry.files).toSorted(([left], [right]) =>
    byCodepoint(left, right),
  );
  const texts = await allInOrder(
    fileEntries.map(([path]) => readText(join(fileRoot, path), missing(`file ${path}`))),
  );
  const files = new Map<string, string>();
  for (const [position, [path, expected]] of fileEntries.entries()) {
    const text = texts[position] ?? "";
    verifyIntegrity(computeIntegrity(text), expected, `${subject} file ${path}`);
    files.set(path, text);
  }
  verifyIntegrity(computeModuleIntegrity(manifestText, files), entry.integrity, subject);
  let manifest: ModuleManifest;
  try {
    manifest = parseManifest(
      parseJson(
        manifestText,
        (reason) =>
          new RegistryError(
            "REGISTRY_MANIFEST_INVALID",
            `${subject} manifest is not valid JSON: ${reason}`,
            "Fix the Module source and rebuild the Registry.",
          ),
      ),
    );
  } catch (error) {
    if (error instanceof ManifestError) {
      throw new RegistryError(
        "REGISTRY_MANIFEST_INVALID",
        `${subject} manifest is invalid: ${error.message}`,
        error.code === "manifest_schema_too_new"
          ? "Update the aokit CLI to read this Module."
          : "Fix the Module source and rebuild the Registry.",
      );
    }
    throw error;
  }
  checkManifestMatchesEntry(registryName, name, version, manifest, entry);
  for (const file of manifest.files) {
    if (!files.has(file.from)) {
      throw new RegistryError(
        "REGISTRY_FILE_MISSING",
        `${subject} manifest lists ${file.from}, which the index does not record.`,
        "Add the file under the Module's files/ directory and rebuild the Registry.",
      );
    }
  }
  for (const migration of manifest.migrations) {
    if (!files.has(migration.script)) {
      throw new RegistryError(
        "REGISTRY_FILE_MISSING",
        `${subject} manifest lists migration script ${migration.script}, which the index does not record.`,
        "Add the script under the Module's migrations/ directory and rebuild the Registry.",
      );
    }
  }
  return {
    manifest,
    files,
    integrity: entry.integrity,
    migrationScript: (script) => {
      if (!files.has(script)) {
        throw new RegistryError(
          "REGISTRY_FILE_MISSING",
          `${subject} does not ship ${script}.`,
          "Rebuild the Registry with `bun run registry:build`.",
        );
      }
      return resolve(fileRoot, script);
    },
    renames: parseRenames(files, subject),
  };
}

/**
 * Reads a local Registry directory: validates `index.json`, refuses a Registry that needs a newer
 * CLI, then loads and integrity-checks the Release Catalog and every Module version. No trust
 * prompt, no network.
 */
export async function readLocalRegistry(
  path: string,
  options: ReadLocalRegistryOptions,
): Promise<LocalRegistry> {
  const index = await readIndex(path);
  checkCliVersion(index, options.cliVersion);
  const releaseEntries = Object.entries(index.releases).toSorted(([left], [right]) =>
    byCodepoint(left, right),
  );
  const loadedCatalogs = await allInOrder(
    releaseEntries.map(([release, pointer]) => readCatalog(path, index.name, release, pointer)),
  );
  const catalogs = new Map(
    releaseEntries.map(([release], position) => [release, loadedCatalogs[position]] as const),
  );
  const currentCatalog = catalogs.get(index.release);
  if (currentCatalog === undefined) {
    throw new RegistryError(
      "REGISTRY_CATALOG_INVALID",
      `Registry "${index.name}" has no Catalog for its current Release ${index.release}.`,
      "Rebuild the Registry with `bun run registry:build`.",
    );
  }
  const versions = Object.entries(index.modules)
    .toSorted(([left], [right]) => byCodepoint(left, right))
    .flatMap(([name, moduleEntry]) =>
      Object.entries(moduleEntry.versions)
        .toSorted(([left], [right]) => byCodepoint(left, right))
        .map(([version, versionEntry]) => ({
          name,
          version,
          isLatest: version === moduleEntry.latest,
          versionEntry,
        })),
    );
  const loaded = await allInOrder(
    versions.map(({ name, version, versionEntry }) =>
      readModuleVersion(path, index.name, name, version, versionEntry),
    ),
  );
  const modules = new Map<string, RegistryModule>();
  const everyVersion = new Map<string, Map<string, RegistryModule>>();
  for (const [position, { name, version, isLatest }] of versions.entries()) {
    const module = loaded[position];
    if (module === undefined) {
      continue;
    }
    if (isLatest) {
      modules.set(name, module);
    }
    const byVersion = everyVersion.get(name) ?? new Map<string, RegistryModule>();
    byVersion.set(version, module);
    everyVersion.set(name, byVersion);
  }
  return {
    name: index.name,
    release: index.release,
    currentCatalog,
    modules,
    releases: () => releaseEntries.map(([release]) => release),
    catalog: (release) => catalogs.get(release),
    version: (name, version) => everyVersion.get(name)?.get(version),
    versions: (name) =>
      [...(everyVersion.get(name)?.keys() ?? [])].toSorted((left, right) =>
        Bun.semver.order(left, right),
      ),
  };
}
