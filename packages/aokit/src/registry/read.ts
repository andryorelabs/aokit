import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Catalog,
  catalogSchema,
  ManifestError,
  type ModuleManifest,
  parseManifest,
} from "@aokit/module";
import { RegistryError } from "./errors.ts";
import { computeIntegrity, normalizeLineEndings } from "./integrity.ts";
import {
  type RegistryIndex,
  registryIndexSchema,
  supportedRegistrySchemaVersion,
} from "./schema.ts";

/**
 * A verified Module of a local Registry: its manifest and its files, keyed by the path the
 * manifest's `files[].from` uses.
 */
interface LocalRegistryModule {
  manifest: ModuleManifest;
  files: Map<string, string>;
}

/**
 * A local Registry read from disk with every manifest, file and the Catalog integrity-checked.
 * `modules` holds the `latest` version of each Module.
 */
export interface LocalRegistry {
  name: string;
  release: string;
  catalog: Catalog;
  modules: Map<string, LocalRegistryModule>;
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

function verifyIntegrity(text: string, expected: string, subject: string): void {
  const actual = computeIntegrity(text);
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

async function readCatalog(root: string, index: RegistryIndex): Promise<Catalog> {
  const subject = `Registry "${index.name}" Catalog ${index.catalog.path}`;
  const text = await readText(
    join(root, index.catalog.path),
    () =>
      new RegistryError(
        "REGISTRY_FILE_MISSING",
        `${subject} is missing.`,
        "Rebuild the Registry with `bun run registry:build`.",
      ),
  );
  verifyIntegrity(text, index.catalog.integrity, subject);
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
  if (parsed.data.release !== index.release) {
    throw new RegistryError(
      "REGISTRY_RELEASE_MISMATCH",
      `${subject} belongs to another Release: expected ${index.release}, actual ${parsed.data.release ?? "(none)"}.`,
      `Point the index catalog at catalog/${index.release}.json, or set its "release" to ${index.release}, then rebuild.`,
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

async function readModuleVersion(
  root: string,
  registryName: string,
  name: string,
  version: string,
  entry: RegistryIndex["modules"][string]["versions"][string],
): Promise<LocalRegistryModule> {
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
  verifyIntegrity(manifestText, entry.integrity, `${subject} manifest ${entry.manifest}`);
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
    verifyIntegrity(text, expected, `${subject} file ${path}`);
    files.set(path, text);
  }
  for (const file of manifest.files) {
    if (!files.has(file.from)) {
      throw new RegistryError(
        "REGISTRY_FILE_MISSING",
        `${subject} manifest lists ${file.from}, which the index does not record.`,
        "Add the file under the Module's files/ directory and rebuild the Registry.",
      );
    }
  }
  return { manifest, files };
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
  const catalog = await readCatalog(path, index);
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
  const modules = new Map<string, LocalRegistryModule>();
  for (const [position, { name, isLatest }] of versions.entries()) {
    const module = loaded[position];
    if (isLatest && module !== undefined) {
      modules.set(name, module);
    }
  }
  return { name: index.name, release: index.release, catalog, modules };
}
