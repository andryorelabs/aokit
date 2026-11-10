import { z } from "zod";
import { ManifestError, type ModuleManifest, parseManifest } from "@aokit/module";
import { RegistryError } from "../errors.ts";
import { computeIntegrity, computeModuleIntegrity } from "../integrity.ts";
import type { RegistryTransport } from "../remote.ts";
import type { RegistryIndex } from "../schema.ts";
import {
  allInOrder,
  byCodepoint,
  type CachedModuleVersion,
  type ModuleVersion,
  parseJson,
  rebuildFix,
  type RegistryCache,
  type VersionEntry,
  verifyFix,
  verifyIntegrity,
} from "./common.ts";

const renamesFile = "renames.json";
const renamesSchema = z.record(z.string().min(1), z.string().min(1));

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

export function parseModuleManifest(
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
    return parseManifest(raw, { allowMissingDescription: true });
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

export async function loadModuleVersion(
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
