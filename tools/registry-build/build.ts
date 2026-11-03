import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { catalogSchema, compileModule, stableStringify } from "@aokit/module";
import { format } from "oxfmt";
import {
  computeIntegrity,
  normalizeLineEndings,
  type RegistryIndex,
  registryIndexSchemaUrl,
  supportedRegistrySchemaVersion,
} from "../../packages/aokit/src/registry/index.ts";

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

async function buildCatalog(sourceDir: string, outDir: string): Promise<RegistryIndex["catalog"]> {
  const catalogPath = `${catalogDirectory}/${officialRelease}.json`;
  const sourcePath = join(sourceDir, catalogPath);
  let text: string;
  try {
    text = normalizeLineEndings(await readFile(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(
      `registry:build found no Catalog for Release ${officialRelease} at ${sourcePath}`,
      {
        cause: error,
      },
    );
  }
  const catalog = catalogSchema.parse(JSON.parse(text));
  if (catalog.release !== officialRelease) {
    throw new Error(
      `registry:build: ${sourcePath} has release ${catalog.release ?? "(none)"}, expected ${officialRelease}`,
    );
  }
  await writeText(join(outDir, catalogPath), text);
  return { path: catalogPath, integrity: computeIntegrity(text) };
}

async function buildModule(
  sourceDir: string,
  outDir: string,
  directoryName: string,
): Promise<RegistryIndex["modules"][string]> {
  const moduleDir = join(sourceDir, directoryName);
  const { manifest } = await compileModule(join(moduleDir, moduleSourceFile));
  if (manifest.name !== directoryName) {
    throw new Error(
      `registry:build: ${moduleDir}/${moduleSourceFile} declares name "${manifest.name}", expected "${directoryName}"`,
    );
  }
  const versionDir = join(outDir, "modules", manifest.name, manifest.version);
  const paths = (await listFiles(join(moduleDir, moduleFilesDirectory))).map(
    (relative) => `${moduleFilesDirectory}/${relative}`,
  );
  const copied = await Promise.all(
    paths.map(async (path) => {
      const text = normalizeLineEndings(await readFile(join(moduleDir, path), "utf8"));
      await writeText(join(versionDir, path), text);
      return [path, computeIntegrity(text)] as const;
    }),
  );
  const files: Record<string, string> = Object.fromEntries(copied);
  for (const file of manifest.files) {
    if (!(file.from in files)) {
      throw new Error(
        `registry:build: Module ${manifest.name} lists ${file.from}, which is not under ${moduleDir}/${moduleFilesDirectory}`,
      );
    }
  }
  const manifestPath = `modules/${manifest.name}/${manifest.version}.json`;
  const manifestText = await formatJson(manifestPath, manifest);
  await writeText(join(outDir, manifestPath), manifestText);
  return {
    latest: manifest.version,
    versions: {
      [manifest.version]: {
        manifest: manifestPath,
        integrity: computeIntegrity(manifestText),
        schemaVersion: manifest.schemaVersion,
        provides: manifest.provides.map((entry) => entry.capability),
        files,
      },
    },
  };
}

/**
 * Compiles `sourceDir` (`<name>/module.ts`, `<name>/files/**`, `catalog/<release>.json`) into a
 * Registry directory at `outDir`, replacing it. Output is sorted, LF-only and oxfmt-formatted, so
 * two runs produce byte-identical directories.
 */
export async function buildRegistry(sourceDir: string, outDir: string): Promise<void> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const moduleNames = entries
    .filter((entry) => entry.isDirectory() && entry.name !== catalogDirectory)
    .map((entry) => entry.name)
    .toSorted(byCodepoint);

  await rm(outDir, { recursive: true, force: true });
  const catalog = await buildCatalog(sourceDir, outDir);
  const built = await Promise.all(
    moduleNames.map(async (name) => [name, await buildModule(sourceDir, outDir, name)] as const),
  );
  const modules: RegistryIndex["modules"] = Object.fromEntries(built);
  const index: RegistryIndex = {
    $schema: registryIndexSchemaUrl,
    schemaVersion: supportedRegistrySchemaVersion,
    name: officialRegistryName,
    release: officialRelease,
    minCliVersion: officialMinCliVersion,
    catalog,
    modules,
  };
  await writeText(join(outDir, "index.json"), await formatJson("index.json", index));
}
