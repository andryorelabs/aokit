import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { catalogSchema, compileModule, stableStringify } from "@aokit/module";
import { format } from "oxfmt";
import {
  computeIntegrity,
  computeModuleIntegrity,
  normalizeLineEndings,
  type RegistryIndex,
  registryIndexSchemaUrl,
  supportedRegistrySchemaVersion,
} from "../../packages/aokit/src/registry/index.ts";
import { registryIndexSchema } from "../../packages/aokit/src/registry/schema.ts";

/**
 * Name of the first-party Registry, recorded in the Lockfile `registry` field.
 */
const officialRegistryName = "official";

/**
 * The Release the first-party Registry is built as.
 */
const officialRelease = "2026.11.0";

/**
 * The lowest CLI version able to read this Release.
 */
const officialMinCliVersion = "0.1.0";

const catalogDirectory = "catalog";
const moduleSourceFile = "module.ts";
const moduleFilesDirectory = "files";
const moduleManifestFile = "module.json";

type ModuleEntry = RegistryIndex["modules"][string];
type VersionEntry = ModuleEntry["versions"][string];

function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Lists every file below `root` as sorted POSIX paths relative to it.
 */
export async function listFiles(root: string): Promise<string[]> {
  if (!(await isDirectory(root))) {
    return [];
  }
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll("\\", "/"),
    )
    .toSorted(byCodepoint);
}

async function formatJson(fileName: string, value: unknown): Promise<string> {
  const result = await format(fileName, stableStringify(value));
  if (result.errors.length > 0) {
    throw new Error(
      `registry:build could not format ${fileName}: ${result.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return result.code;
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

async function readExistingIndex(outDir: string): Promise<RegistryIndex | undefined> {
  const path = join(outDir, "index.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const parsed = registryIndexSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(
      `registry:build cannot extend ${path}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}. Delete the registry directory to start over.`,
    );
  }
  return parsed.data;
}

async function buildReleases(
  sourceDir: string,
  outDir: string,
  existing: RegistryIndex["releases"],
): Promise<RegistryIndex["releases"]> {
  const catalogSourceDir = join(sourceDir, catalogDirectory);
  const sourcePaths = (await listFiles(catalogSourceDir)).filter((path) => path.endsWith(".json"));
  const releases: RegistryIndex["releases"] = { ...existing };
  const sources = await Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const release = sourcePath.slice(0, -".json".length);
      const text = normalizeLineEndings(await readFile(join(catalogSourceDir, sourcePath), "utf8"));
      const catalog = catalogSchema.parse(JSON.parse(text));
      if (catalog.release !== release) {
        throw new Error(
          `registry:build: ${join(catalogSourceDir, sourcePath)} has release ${catalog.release ?? "(none)"}, expected ${release}`,
        );
      }
      const pointer = {
        path: `${catalogDirectory}/${sourcePath}`,
        integrity: computeIntegrity(text),
      };
      const published = existing[release];
      if (published !== undefined && published.integrity !== pointer.integrity) {
        throw new Error(
          `registry:build: Release ${release} is already published with a different Catalog (published ${published.integrity}, source ${pointer.integrity}). Publish a new Release instead of editing ${release}.`,
        );
      }
      return { release, text, pointer };
    }),
  );
  await Promise.all(
    sources.map(({ pointer, text }) => writeText(join(outDir, pointer.path), text)),
  );
  for (const { release, pointer } of sources) {
    releases[release] = pointer;
  }
  if (!(officialRelease in releases)) {
    throw new Error(
      `registry:build found no Catalog for Release ${officialRelease} at ${join(catalogSourceDir, `${officialRelease}.json`)}`,
    );
  }
  return releases;
}

async function buildModuleVersion(
  sourceDir: string,
  outDir: string,
  directoryName: string,
  published: ModuleEntry | undefined,
): Promise<{ version: string; entry: VersionEntry }> {
  const moduleDir = join(sourceDir, directoryName);
  const { manifest } = await compileModule(join(moduleDir, moduleSourceFile));
  if (manifest.name !== directoryName) {
    throw new Error(
      `registry:build: ${moduleDir}/${moduleSourceFile} declares name "${manifest.name}", expected "${directoryName}"`,
    );
  }
  const paths = (await listFiles(join(moduleDir, moduleFilesDirectory))).map(
    (relative) => `${moduleFilesDirectory}/${relative}`,
  );
  const texts = new Map<string, string>(
    await Promise.all(
      paths.map(
        async (path) =>
          [path, normalizeLineEndings(await readFile(join(moduleDir, path), "utf8"))] as const,
      ),
    ),
  );
  for (const file of manifest.files) {
    if (!texts.has(file.from)) {
      throw new Error(
        `registry:build: Module ${manifest.name} lists ${file.from}, which is not under ${moduleDir}/${moduleFilesDirectory}`,
      );
    }
  }
  const versionPath = `modules/${manifest.name}/${manifest.version}`;
  const manifestPath = `${versionPath}/${moduleManifestFile}`;
  const manifestText = await formatJson(manifestPath, manifest);
  const entry: VersionEntry = {
    manifest: manifestPath,
    integrity: computeModuleIntegrity(manifestText, texts),
    schemaVersion: manifest.schemaVersion,
    provides: manifest.provides.map((provided) => provided.capability),
    files: Object.fromEntries(
      [...texts].map(([path, text]) => [path, computeIntegrity(text)] as const),
    ),
  };
  const publishedEntry = published?.versions[manifest.version];
  if (publishedEntry !== undefined) {
    if (publishedEntry.integrity !== entry.integrity) {
      throw new Error(
        `registry:build: ${manifest.name}@${manifest.version} is already published with different content (published ${publishedEntry.integrity}, source ${entry.integrity}). Bump the version in ${moduleDir}/${moduleSourceFile} instead of editing a published version.`,
      );
    }
    return { version: manifest.version, entry: publishedEntry };
  }
  await writeText(join(outDir, manifestPath), manifestText);
  await Promise.all(
    [...texts].map(([path, text]) => writeText(join(outDir, versionPath, path), text)),
  );
  return { version: manifest.version, entry };
}

function latestOf(versions: readonly string[]): string {
  const sorted = versions.toSorted((left, right) => Bun.semver.order(left, right));
  const latest = sorted.at(-1);
  if (latest === undefined) {
    throw new Error("registry:build: a Module has no versions");
  }
  return latest;
}

/**
 * Compiles `sourceDir` (`<name>/module.ts`, `<name>/files/**`, `catalog/<release>.json`) into the
 * Registry directory `outDir`, only adding: each new Module version gets
 * `modules/<name>/<version>/`, each Release one `catalog/<release>.json`, and `index.json` lists
 * everything published. Already published versions and Releases are left untouched; building
 * fails naming `<module>@<version>` (or the Release) when its source content would change. Output
 * is sorted, LF-only and oxfmt-formatted, so a build is reproducible.
 */
export async function buildRegistry(sourceDir: string, outDir: string): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const moduleNames = entries
    .filter((entry) => entry.isDirectory() && entry.name !== catalogDirectory)
    .map((entry) => entry.name)
    .toSorted(byCodepoint);

  const existing = await readExistingIndex(outDir);
  const releases = await buildReleases(sourceDir, outDir, existing?.releases ?? {});
  const built = await Promise.all(
    moduleNames.map(
      async (name) =>
        [name, await buildModuleVersion(sourceDir, outDir, name, existing?.modules[name])] as const,
    ),
  );
  const modules: RegistryIndex["modules"] = { ...existing?.modules };
  for (const [name, { version, entry }] of built) {
    const versions = { ...modules[name]?.versions, [version]: entry };
    modules[name] = { latest: latestOf(Object.keys(versions)), versions };
  }
  const index: RegistryIndex = {
    $schema: registryIndexSchemaUrl,
    schemaVersion: supportedRegistrySchemaVersion,
    name: officialRegistryName,
    release: officialRelease,
    minCliVersion: officialMinCliVersion,
    releases,
    modules,
  };
  await writeText(join(outDir, "index.json"), await formatJson("index.json", index));
}
