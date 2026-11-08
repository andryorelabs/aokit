import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
  type ModuleManifest,
  catalogSchema,
  compileModule,
  composeDraftCatalog,
  stableStringify,
} from "@aokit/module";
import { format } from "oxfmt";
import { layoutTables } from "../../packages/aokit/src/engine/layout.ts";
import {
  computeIntegrity,
  computeModuleIntegrity,
  normalizeLineEndings,
  type RegistryIndex,
  registryIndexSchemaUrl,
  supportedRegistrySchemaVersion,
} from "../../packages/aokit/src/registry/index.ts";
import {
  catalogFileSchema,
  registryIndexSchema,
  releaseModulesSchema,
  yankedListSchema,
} from "../../packages/aokit/src/registry/schema.ts";

/**
 * Name of the first-party Registry, recorded in the Lockfile `registry` field.
 */
const officialRegistryName = "official";

/**
 * The lowest CLI version able to read this Release.
 */
const officialMinCliVersion = "0.1.0";

const catalogDirectory = "catalog";
const moduleSourceFile = "module.ts";
const moduleCatalogFragmentFile = "catalog.json";
const moduleFilesDirectory = "files";
const moduleManifestFile = "module.json";
const moduleMigrationsDirectory = "migrations";
const moduleRenamesFile = "renames.json";
const migrationRuntimeNamespace = "aokit-migration-runtime";

/**
 * The `// <path>` banner Bun writes above each bundled module; it embeds the machine-specific
 * source path, so it is dropped to keep a build reproducible.
 */
const bundlerPathComment = /^\/\/ (?:aokit-migration-runtime:.*|.*\.[cm]?[jt]s)\n/gm;

type ModuleEntry = RegistryIndex["modules"][string];
type VersionEntry = ModuleEntry["versions"][string];

function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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

function modulesField(raw: unknown): unknown {
  const file = catalogFileSchema.safeParse(raw);
  return file.success ? file.data["modules"] : undefined;
}

async function readPublishedModules(
  outDir: string,
  pointer: RegistryIndex["releases"][string],
): Promise<Record<string, string> | undefined> {
  const raw: unknown = JSON.parse(await readFile(join(outDir, pointer.path), "utf8"));
  const parsed = releaseModulesSchema.safeParse(modulesField(raw));
  return parsed.success ? parsed.data : undefined;
}

function latestVersions(modules: RegistryIndex["modules"]): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modules)
      .toSorted(([left], [right]) => byCodepoint(left, right))
      .map(([name, entry]) => [name, entry.latest] as const),
  );
}

/**
 * Resolves the Module version map a Release Catalog carries: the source's `modules`, else the map
 * the already published Catalog holds, else the latest version of every Module. Every mapped
 * version must be one the index lists.
 */
async function resolveReleaseModules(
  outDir: string,
  release: string,
  declared: Record<string, string> | undefined,
  published: RegistryIndex["releases"][string] | undefined,
  modules: RegistryIndex["modules"],
): Promise<Record<string, string>> {
  const resolved =
    declared ??
    (published === undefined ? undefined : await readPublishedModules(outDir, published)) ??
    latestVersions(modules);
  for (const [name, version] of Object.entries(resolved)) {
    if (modules[name]?.versions[version] === undefined) {
      throw new Error(
        `registry:build: Release ${release} maps ${name} to ${version}, which no Module source builds.`,
      );
    }
  }
  return Object.fromEntries(
    Object.entries(resolved).toSorted(([left], [right]) => byCodepoint(left, right)),
  );
}

async function buildReleases(
  sourceDir: string,
  outDir: string,
  existing: RegistryIndex["releases"],
  moduleIndex: RegistryIndex["modules"],
  includeDraft: boolean,
): Promise<RegistryIndex["releases"]> {
  const catalogSourceDir = join(sourceDir, catalogDirectory);
  const sourcePaths = (await listFiles(catalogSourceDir)).filter((path) => path.endsWith(".json"));
  const releases: RegistryIndex["releases"] = { ...existing };
  const sources = await Promise.all(
    sourcePaths.map(async (sourcePath) => {
      const release = sourcePath.slice(0, -".json".length);
      const text = normalizeLineEndings(await readFile(join(catalogSourceDir, sourcePath), "utf8"));
      const rawCatalog: unknown = JSON.parse(text);
      const declaredModules = releaseModulesSchema.optional().parse(modulesField(rawCatalog));
      const { modules: _declared, ...catalogSource } = catalogFileSchema.parse(rawCatalog);
      const catalog = catalogSchema.parse(catalogSource);
      if (catalog.release !== release) {
        throw new Error(
          `registry:build: ${join(catalogSourceDir, sourcePath)} has release ${catalog.release ?? "(none)"}, expected ${release}`,
        );
      }
      const published = existing[release];
      const releaseModules = await resolveReleaseModules(
        outDir,
        release,
        declaredModules,
        published,
        moduleIndex,
      );
      const catalogText = await formatJson(`${catalogDirectory}/${sourcePath}`, {
        ...catalogSource,
        modules: releaseModules,
      });
      const pointer = {
        path: `${catalogDirectory}/${sourcePath}`,
        integrity: computeIntegrity(catalogText),
      };
      if (published !== undefined && published.integrity !== pointer.integrity) {
        throw new Error(
          `registry:build: Release ${release} is already published with a different Catalog (published ${published.integrity}, source ${pointer.integrity}). Publish a new Release instead of editing ${release}.`,
        );
      }
      return { release, text: catalogText, pointer };
    }),
  );
  await Promise.all(
    sources.map(({ pointer, text }) => writeText(join(outDir, pointer.path), text)),
  );
  for (const { release, pointer } of sources) {
    releases[release] = pointer;
  }
  if (includeDraft) {
    const draft = await buildDraftRelease(sourceDir, outDir, releases, moduleIndex);
    releases[draft.release] = draft.pointer;
  }
  if (Object.keys(releases).length === 0) {
    throw new Error(`registry:build found no Catalog in ${catalogSourceDir}`);
  }
  return releases;
}

/**
 * Writes the draft Release a real-build uses: the composed draft Catalog under the next patch
 * Release after the latest one, mapping every Module (Pending ones included) to its latest version.
 */
async function buildDraftRelease(
  sourceDir: string,
  outDir: string,
  releases: RegistryIndex["releases"],
  moduleIndex: RegistryIndex["modules"],
): Promise<{ release: string; pointer: RegistryIndex["releases"][string] }> {
  const [major, minor, patch] = latestOf(Object.keys(releases)).split(".");
  const release = `${major}.${minor}.${Number(patch) + 1}`;
  if (release in releases) {
    throw new Error(`registry:build: draft Release ${release} collides with a published Release`);
  }
  const catalog = { ...composeDraftCatalog(sourceDir), release };
  const modules = await resolveReleaseModules(outDir, release, undefined, undefined, moduleIndex);
  const path = `${catalogDirectory}/${release}.json`;
  const text = await formatJson(path, { ...catalog, modules });
  await writeText(join(outDir, path), text);
  return { release, pointer: { path, integrity: computeIntegrity(text) } };
}

/**
 * Compiles one `migrations/*.ts` source to a self-contained ES module. `@aokit/module` resolves to
 * a one-line `defineMigration` identity so the published script imports nothing at runtime.
 */
async function compileMigration(sourcePath: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [sourcePath],
    target: "node",
    format: "esm",
    minify: false,
    sourcemap: "none",
    plugins: [
      {
        name: "aokit-migration-runtime",
        setup(build) {
          build.onResolve({ filter: /^@aokit\/module$/ }, () => ({
            path: "@aokit/module",
            namespace: migrationRuntimeNamespace,
          }));
          build.onLoad({ filter: /.*/, namespace: migrationRuntimeNamespace }, () => ({
            contents: "export const defineMigration = (fn) => fn;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const output = result.outputs[0];
  if (!result.success || output === undefined) {
    throw new Error(
      `registry:build could not compile ${sourcePath}: ${result.logs.map((log) => log.message).join("; ")}`,
    );
  }
  return normalizeLineEndings(await output.text()).replaceAll(bundlerPathComment, "");
}

async function readMigrationTexts(moduleDir: string): Promise<Map<string, string>> {
  const sources = (await listFiles(join(moduleDir, moduleMigrationsDirectory))).filter(
    (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
  );
  return new Map(
    await Promise.all(
      sources.map(
        async (source) =>
          [
            `${moduleMigrationsDirectory}/${source.slice(0, -".ts".length)}.js`,
            await compileMigration(join(moduleDir, moduleMigrationsDirectory, source)),
          ] as const,
      ),
    ),
  );
}

async function readRenamesText(moduleDir: string): Promise<string | undefined> {
  try {
    return normalizeLineEndings(await readFile(join(moduleDir, moduleRenamesFile), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

const reservedModuleName = "aokit";
const regionFileNames = new Set(["AGENTS.md", "CLAUDE.md"]);
const skillPathPattern = /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/u;

function frontmatterField(text: string, field: string): string | undefined {
  const block = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text)?.[1];
  const line = block?.split("\n").find((candidate) => candidate.startsWith(`${field}:`));
  const raw = line?.slice(field.length + 1).trim();
  return raw?.replace(/^(["'])(.*)\1$/u, "$2");
}

function validateRegionFileWrites(manifest: ModuleManifest): void {
  if (manifest.name === reservedModuleName) {
    throw new Error(
      `registry:build: Module ${manifest.name} uses the reserved name "${reservedModuleName}", which belongs to the aokit core owner`,
    );
  }
  for (const file of manifest.files) {
    const destination = posix.normalize(file.to);
    const writesRegionFile = Object.values(layoutTables).some((table) =>
      regionFileNames.has(posix.normalize(posix.join(table[file.target], destination))),
    );
    if (writesRegionFile) {
      throw new Error(
        `registry:build: Module ${manifest.name} writes ${file.to} (target ${file.target}) into the project root; Modules contribute only Regions to it through appendRegion`,
      );
    }
  }
}

function validateSkills(manifest: ModuleManifest, texts: ReadonlyMap<string, string>): void {
  for (const file of manifest.files) {
    const directory = skillPathPattern.exec(file.to)?.[1];
    if (directory === undefined) continue;
    const text = texts.get(file.from) ?? "";
    const prefix = `registry:build: Module ${manifest.name} skill ${directory}`;
    if (frontmatterField(text, "name") !== directory) {
      throw new Error(`${prefix}: name must equal "${directory}" (${file.to})`);
    }
    if ((frontmatterField(text, "description") ?? "") === "") {
      throw new Error(`${prefix}: description must not be empty (${file.to})`);
    }
  }
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
  validateRegionFileWrites(manifest);
  validateSkills(manifest, texts);
  for (const [path, text] of await readMigrationTexts(moduleDir)) {
    texts.set(path, text);
  }
  const renamesText = await readRenamesText(moduleDir);
  if (renamesText !== undefined) {
    texts.set(moduleRenamesFile, renamesText);
  }
  for (const migration of manifest.migrations) {
    if (!texts.has(migration.script)) {
      throw new Error(
        `registry:build: Module ${manifest.name} migration ${migration.from} -> ${migration.to} lists ${migration.script}, which is not compiled from ${moduleDir}/${moduleMigrationsDirectory}`,
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

const yankedFile = "yanked.json";
const yankedEntry = /^(.+)@(\d+\.\d+\.\d+.*)$/;

/**
 * Reads `yanked.json` (`["<module>@<version>"]`) from the source directory; empty when absent.
 */
async function readYanked(sourceDir: string): Promise<Map<string, Set<string>>> {
  let text: string;
  try {
    text = await readFile(join(sourceDir, yankedFile), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
  const parsed = yankedListSchema.parse(JSON.parse(text));
  const yanked = new Map<string, Set<string>>();
  for (const item of parsed) {
    const match = yankedEntry.exec(item);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error(`registry:build: ${yankedFile} entry "${item}" is not <module>@<version>`);
    }
    yanked.set(match[1], (yanked.get(match[1]) ?? new Set()).add(match[2]));
  }
  return yanked;
}

/**
 * Sets `yanked: true` on exactly the listed versions and points `latest` at the highest version
 * that is not yanked. Fails naming an entry no Module version matches, or a Module left with no
 * selectable version.
 */
function applyYanked(
  modules: RegistryIndex["modules"],
  yanked: ReadonlyMap<string, ReadonlySet<string>>,
): RegistryIndex["modules"] {
  for (const [name, versions] of yanked) {
    for (const version of versions) {
      if (modules[name]?.versions[version] === undefined) {
        throw new Error(
          `registry:build: ${yankedFile} lists ${name}@${version}, which is not built`,
        );
      }
    }
  }
  return Object.fromEntries(
    Object.entries(modules).map(([name, entry]) => {
      const versions = Object.fromEntries(
        Object.entries(entry.versions).map(([version, { yanked: _previous, ...rest }]) => [
          version,
          yanked.get(name)?.has(version) === true ? { ...rest, yanked: true as const } : rest,
        ]),
      );
      const selectable = Object.keys(versions).filter((version) => !yanked.get(name)?.has(version));
      if (selectable.length === 0) {
        throw new Error(`registry:build: every version of ${name} is yanked`);
      }
      return [name, { latest: latestOf(selectable), versions }] as const;
    }),
  );
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
 * Compiles `sourceDir` (`<name>/module.ts`, `<name>/files/**`, `<name>/migrations/*.ts`, `<name>/renames.json`, `catalog/<release>.json`) into the
 * Registry directory `outDir`, only adding: each new Module version gets
 * `modules/<name>/<version>/`, each Release one `catalog/<release>.json`, and `index.json` lists
 * everything published. Already published versions and Releases are left untouched; building
 * fails naming `<module>@<version>` (or the Release) when its source content would change. Output
 * is sorted, LF-only and oxfmt-formatted, so a build is reproducible.
 *
 * A Pending Module (a `catalog.json` Catalog fragment and no published version) is skipped, so the
 * Registry stays byte-identical until its Release cut. `includePending` builds those Modules too
 * and adds a draft Release whose Catalog is the composed draft Catalog; it is meant for a
 * temporary output directory.
 */
export async function buildRegistry(
  sourceDir: string,
  outDir: string,
  options: { includePending?: boolean } = {},
): Promise<void> {
  const includePending = options.includePending === true;
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const existing = await readExistingIndex(outDir);
  const candidateNames = entries
    .filter((entry) => entry.isDirectory() && entry.name !== catalogDirectory)
    .map((entry) => entry.name)
    .toSorted(byCodepoint);
  const fragmentFlags = await Promise.all(
    candidateNames.map((name) => isFile(join(sourceDir, name, moduleCatalogFragmentFile))),
  );
  const pendingNames = new Set(
    candidateNames.filter(
      (name, position) => fragmentFlags[position] === true && existing?.modules[name] === undefined,
    ),
  );
  const moduleNames = candidateNames.filter((name) => includePending || !pendingNames.has(name));
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
  const publishedModules = applyYanked(modules, await readYanked(sourceDir));
  const releases = await buildReleases(
    sourceDir,
    outDir,
    existing?.releases ?? {},
    publishedModules,
    includePending && pendingNames.size > 0,
  );
  const index: RegistryIndex = {
    $schema: registryIndexSchemaUrl,
    schemaVersion: supportedRegistrySchemaVersion,
    name: officialRegistryName,
    release: latestOf(Object.keys(releases)),
    minCliVersion: officialMinCliVersion,
    releases,
    modules: publishedModules,
  };
  await writeText(join(outDir, "index.json"), await formatJson("index.json", index));
}
