import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type CachedModuleVersion,
  type ModuleVersion,
  openRegistry,
  parseRegistrySource,
  type Registry,
  type RegistryCache,
  RegistryError,
} from "../../src/registry/index.ts";
import { z } from "zod";
import { parseJsonRecord } from "../helpers/registry-json.ts";
import {
  builtFixtureRegistry,
  editJson,
  removeTemporaryDirectories,
  serveRegistry,
} from "../registry-remote/served-registry.ts";

function computeIntegrity(text: string): string {
  return `sha256-${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function computeModuleIntegrity(manifestText: string, files: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  const frame = (label: string, text: string): void => {
    hash.update(`${label}\0${Buffer.byteLength(text, "utf8")}\0`, "utf8");
    hash.update(text, "utf8");
  };
  frame("manifest", manifestText);
  for (const path of [...files.keys()].toSorted()) {
    frame(`file:${path}`, files.get(path) ?? "");
  }
  return `sha256-${hash.digest("hex")}`;
}

const context = { cliVersion: "0.1.0" };
const sourceContext = { projectDir: "/work/app", bundledRegistryPath: "/unused" };

afterEach(removeTemporaryDirectories);

async function captureError(action: () => Promise<unknown>): Promise<RegistryError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RegistryError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a RegistryError");
}

function captureSyncError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function openLocal(root: string): Promise<Registry> {
  return openRegistry({ kind: "local", path: root }, context);
}

interface ResealOptions {
  readonly manifest?: (manifest: Record<string, unknown>) => void;
  readonly files?: Readonly<Record<string, string>>;
  readonly entry?: (entry: Record<string, unknown>) => void;
}

const indexShape = z.looseObject({
  modules: z.record(
    z.string(),
    z.looseObject({ versions: z.record(z.string(), z.record(z.string(), z.unknown())) }),
  ),
  releases: z.record(z.string(), z.record(z.string(), z.unknown())),
});

async function editIndex(root: string, edit: (index: z.infer<typeof indexShape>) => void) {
  const path = join(root, "index.json");
  const index = indexShape.parse(JSON.parse(await readFile(path, "utf8")));
  edit(index);
  await writeFile(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

/**
 * Edits one Module version on disk and rewrites its index entry so every integrity matches the
 * edited content, leaving only the semantic inconsistency under test.
 */
async function resealModule(
  root: string,
  name: string,
  version: string,
  options: ResealOptions,
): Promise<void> {
  const directory = join(root, "modules", name, version);
  const manifestPath = join(directory, "module.json");
  const manifest = parseJsonRecord(await readFile(manifestPath, "utf8"));
  options.manifest?.(manifest);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestText, "utf8");
  await Promise.all(
    Object.entries(options.files ?? {}).map(async ([path, text]) => {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), text, "utf8");
    }),
  );
  const paths = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: directory, dot: true })))
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path !== "module.json")
    .toSorted();
  const files = new Map(
    await Promise.all(
      paths.map(async (path): Promise<[string, string]> => [
        path,
        await readFile(join(directory, path), "utf8"),
      ]),
    ),
  );
  await editIndex(root, (index) => {
    const entry = index.modules[name]?.versions[version];
    if (entry === undefined) {
      throw new Error(`fixture has no ${name}@${version}`);
    }
    entry.files = Object.fromEntries(
      [...files].map(([path, text]) => [path, computeIntegrity(text)]),
    );
    entry.integrity = computeModuleIntegrity(manifestText, files);
    options.entry?.(entry);
  });
}

async function repointRelease(root: string, release: string, integrity: string): Promise<void> {
  await editIndex(root, (index) => {
    index.releases[release] = { path: `catalog/${release}.json`, integrity };
  });
}

async function writeCatalog(root: string, text: string, release = "2026.11.0"): Promise<void> {
  await writeFile(join(root, `catalog/${release}.json`), text, "utf8");
  await repointRelease(root, release, computeIntegrity(text));
}

async function editCatalog(
  root: string,
  edit: (catalog: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(root, "catalog/2026.11.0.json");
  await editJson(path, edit);
  await repointRelease(root, "2026.11.0", computeIntegrity(await readFile(path, "utf8")));
}

async function versionError(root: string): Promise<RegistryError> {
  const registry = await openLocal(root);
  return captureError(() => registry.version("oxc", "1.0.0"));
}

test("a Registry without index.json fails with REGISTRY_NOT_FOUND", async () => {
  const root = await builtFixtureRegistry();
  await rm(join(root, "index.json"));
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_NOT_FOUND");
  expect(error.message).toContain("index.json");
});

test("an index that is not JSON fails with REGISTRY_INDEX_INVALID", async () => {
  const root = await builtFixtureRegistry();
  await writeFile(join(root, "index.json"), "{not json", "utf8");
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_INDEX_INVALID");
  expect(error.message).toContain("is not valid JSON");
});

for (const [label, text] of [
  ["an empty object", "{}"],
  ["an array", "[]"],
  ["null", "null"],
  ["mistyped modules", '{"schemaVersion":1,"modules":5}'],
] as const) {
  test(`an index that is ${label} fails the schema with REGISTRY_INDEX_INVALID`, async () => {
    const root = await builtFixtureRegistry();
    await writeFile(join(root, "index.json"), text, "utf8");
    const error = await captureError(() => openLocal(root));
    expect(error.code).toBe("REGISTRY_INDEX_INVALID");
    expect(error.message).toContain("is invalid");
  });
}

test("an index with a newer schemaVersion fails with REGISTRY_SCHEMA_TOO_NEW", async () => {
  const root = await builtFixtureRegistry();
  await editJson(join(root, "index.json"), (index) => {
    index.schemaVersion = 99;
  });
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_SCHEMA_TOO_NEW");
  expect(error.data.actual).toBe("99");
});

test("a Catalog that the Registry does not serve fails with REGISTRY_FILE_MISSING", async () => {
  const root = await builtFixtureRegistry();
  await rm(join(root, "catalog/2026.11.0.json"));
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_FILE_MISSING");
  expect(error.message).toContain("catalog/2026.11.0.json");
});

test("a Catalog that is not JSON fails with REGISTRY_CATALOG_INVALID", async () => {
  const root = await builtFixtureRegistry();
  await writeCatalog(root, "{broken");
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
  expect(error.message).toContain("is invalid");
});

test("a Catalog that fails its schema reports both the Catalog and the modules issues", async () => {
  const root = await builtFixtureRegistry();
  await editCatalog(root, (catalog) => {
    catalog.dependencies = 5;
    catalog.modules = { oxc: 5 };
  });
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
  expect(error.message).toContain("modules:");
});

test("a Catalog that fails only its own schema fails with REGISTRY_CATALOG_INVALID", async () => {
  const root = await builtFixtureRegistry();
  await editCatalog(root, (catalog) => {
    catalog.dependencies = 5;
  });
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
  expect(error.message).not.toContain("modules:");
});

test("a Catalog that is not an object fails with REGISTRY_CATALOG_INVALID", async () => {
  const root = await builtFixtureRegistry();
  await writeCatalog(root, "[]");
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
});

test("a Catalog of another Release fails with REGISTRY_RELEASE_MISMATCH naming both", async () => {
  const root = await builtFixtureRegistry();
  await editCatalog(root, (catalog) => {
    catalog.release = "2025.1.0";
  });
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_RELEASE_MISMATCH");
  expect(error.data).toMatchObject({ expected: "2026.11.0", actual: "2025.1.0" });
});

test("a Catalog without a release field fails with REGISTRY_RELEASE_MISMATCH reporting none", async () => {
  const root = await builtFixtureRegistry();
  await editCatalog(root, (catalog) => {
    delete catalog.release;
  });
  const error = await captureError(() => openLocal(root));
  expect(error.code).toBe("REGISTRY_RELEASE_MISMATCH");
  expect(error.data.actual).toBe("(none)");
});

test("a broken older Catalog fails only when read, and a fixed one is read on the next attempt", async () => {
  const root = await builtFixtureRegistry();
  const current = await readFile(join(root, "catalog/2026.11.0.json"), "utf8");
  await writeCatalog(root, "{broken", "2025.1.0");
  const registry = await openLocal(root);
  expect(registry.releases()).toEqual(["2025.1.0", "2026.11.0"]);
  const first = await captureError(() => registry.catalog("2025.1.0"));
  expect(first.code).toBe("REGISTRY_CATALOG_INVALID");
  await writeCatalog(root, current, "2025.1.0");
  const reopened = await openLocal(root);
  const second = await captureError(() => reopened.catalog("2025.1.0"));
  expect(second.code).toBe("REGISTRY_RELEASE_MISMATCH");
});

test("a missing manifest or Module file fails with REGISTRY_FILE_MISSING", async () => {
  const root = await builtFixtureRegistry();
  await rm(join(root, "modules/knip/2.1.0/module.json"));
  await rm(join(root, "modules/oxc/1.0.0/files/nested/notes.md"));
  const registry = await openLocal(root);
  const manifestError = await captureError(() => registry.version("knip", "2.1.0"));
  expect(manifestError.code).toBe("REGISTRY_FILE_MISSING");
  expect(manifestError.message).toContain("manifest modules/knip/2.1.0/module.json");
  const fileError = await captureError(() => registry.version("oxc", "1.0.0"));
  expect(fileError.code).toBe("REGISTRY_FILE_MISSING");
  expect(fileError.message).toContain("file files/nested/notes.md");
});

test("a manifest that is not JSON fails with REGISTRY_MANIFEST_INVALID", async () => {
  const root = await builtFixtureRegistry();
  await writeFile(join(root, "modules/knip/2.1.0/module.json"), "{broken", "utf8");
  await editIndex(root, (index) => {
    const entry = index.modules.knip?.versions["2.1.0"];
    if (entry !== undefined) {
      entry.integrity = computeModuleIntegrity("{broken", new Map());
    }
  });
  const registry = await openLocal(root);
  const error = await captureError(() => registry.version("knip", "2.1.0"));
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
  expect(error.fix).toContain("rebuild the Registry");
});

test("a manifest that fails the schema carries the fix to repair the Module source", async () => {
  const root = await builtFixtureRegistry();
  await resealModule(root, "oxc", "1.0.0", {
    manifest: (manifest) => {
      delete manifest.name;
    },
  });
  const error = await versionError(root);
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
  expect(error.fix).toBe("Fix the Module source and rebuild the Registry.");
});

test("a manifest with a newer schemaVersion carries the fix to update the CLI", async () => {
  const root = await builtFixtureRegistry();
  await resealModule(root, "oxc", "1.0.0", {
    manifest: (manifest) => {
      manifest.schemaVersion = 99;
    },
  });
  const error = await versionError(root);
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
  expect(error.fix).toBe("Update the aokit CLI to read this Module.");
});

const summaryMismatches: readonly (readonly [string, ResealOptions])[] = [
  [
    "name",
    {
      manifest: (manifest) => {
        manifest.name = "other";
      },
    },
  ],
  [
    "version",
    {
      manifest: (manifest) => {
        manifest.version = "1.0.1";
      },
    },
  ],
  [
    "schemaVersion",
    {
      entry: (entry) => {
        entry.schemaVersion = 2;
      },
    },
  ],
  [
    "provides",
    {
      entry: (entry) => {
        entry.provides = ["lint"];
      },
    },
  ],
];

for (const [field, options] of summaryMismatches) {
  test(`a manifest that disagrees with the index on ${field} fails with REGISTRY_SUMMARY_MISMATCH`, async () => {
    const root = await builtFixtureRegistry();
    await resealModule(root, "oxc", "1.0.0", options);
    const error = await versionError(root);
    expect(error.code).toBe("REGISTRY_SUMMARY_MISMATCH");
    expect(error.message).toContain(`on ${field}`);
  });
}

test("a manifest file the index does not record fails with REGISTRY_FILE_MISSING", async () => {
  const root = await builtFixtureRegistry();
  await resealModule(root, "oxc", "1.0.0", {
    manifest: (manifest) => {
      manifest.files = [{ from: "files/absent.json", target: "config", to: "absent.json" }];
    },
  });
  const error = await versionError(root);
  expect(error.code).toBe("REGISTRY_FILE_MISSING");
  expect(error.message).toContain("files/absent.json");
  expect(error.fix).toContain("files/ directory");
});

test("a migration script the index does not record fails with REGISTRY_FILE_MISSING", async () => {
  const root = await builtFixtureRegistry();
  await resealModule(root, "oxc", "1.0.0", {
    manifest: (manifest) => {
      manifest.migrations = [
        { from: "<1.0.0", to: "1.0.0", stage: "before", script: "migrations/absent.ts" },
      ];
    },
  });
  const error = await versionError(root);
  expect(error.code).toBe("REGISTRY_FILE_MISSING");
  expect(error.message).toContain("migration script migrations/absent.ts");
  expect(error.fix).toContain("migrations/ directory");
});

for (const [label, text] of [
  ["not JSON", "{broken"],
  ["not an object of strings", '{"old.txt": 1}'],
] as const) {
  test(`a renames.json that is ${label} fails with REGISTRY_MANIFEST_INVALID`, async () => {
    const root = await builtFixtureRegistry();
    await resealModule(root, "oxc", "1.0.0", { files: { "renames.json": text } });
    const error = await versionError(root);
    expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
    expect(error.message).toContain("renames.json is invalid");
  });
}

test("a valid renames.json is read into the Module version", async () => {
  const root = await builtFixtureRegistry();
  await resealModule(root, "oxc", "1.0.0", {
    files: { "renames.json": '{"old.txt":"new.txt"}' },
  });
  const version: ModuleVersion = await (await openLocal(root)).version("oxc", "1.0.0");
  expect(version.renames).toEqual({ "old.txt": "new.txt" });
});

const migratingModule: ResealOptions = {
  manifest: (manifest) => {
    manifest.migrations = [
      { from: "<1.0.0", to: "1.0.0", stage: "before", script: "migrations/run.ts" },
    ];
  },
  files: { "migrations/run.ts": "export default {};\n" },
};

test("migrationScript resolves a shipped script on disk and fails for a script the Module lacks", async () => {
  const root = await builtFixtureRegistry();
  await resealModule(root, "oxc", "1.0.0", migratingModule);
  const version = await (await openLocal(root)).version("oxc", "1.0.0");
  expect(version.migrationScript("migrations/run.ts")).toBe(
    join(root, "modules/oxc/1.0.0/migrations/run.ts"),
  );
  const missing = captureSyncError(() => version.migrationScript("migrations/other.ts"));
  expect(missing).toBeInstanceOf(RegistryError);
  expect(missing instanceof RegistryError && missing.code).toBe("REGISTRY_FILE_MISSING");
});

test("migrationScript on a URL transport fails with REGISTRY_SOURCE_UNSUPPORTED", async () => {
  const root = await builtFixtureRegistry();
  await resealModule(root, "oxc", "1.0.0", migratingModule);
  const server = serveRegistry(root);
  try {
    const registry = await openRegistry(parseRegistrySource(server.url, sourceContext), context);
    const version = await registry.version("oxc", "1.0.0");
    const unsupported = captureSyncError(() => version.migrationScript("migrations/run.ts"));
    expect(unsupported).toBeInstanceOf(RegistryError);
    expect(unsupported instanceof RegistryError && unsupported.code).toBe(
      "REGISTRY_SOURCE_UNSUPPORTED",
    );
  } finally {
    await server.stop();
  }
});

test("a cache entry holding other files than the index records is refetched and replaced", async () => {
  const root = await builtFixtureRegistry();
  const server = serveRegistry(root);
  try {
    const entries = new Map<string, CachedModuleVersion>();
    const cache: RegistryCache = {
      get: (integrity) => Promise.resolve(entries.get(integrity)),
      put: (integrity, content) => {
        entries.set(integrity, content);
        return Promise.resolve();
      },
    };
    const source = parseRegistrySource(server.url, sourceContext);
    const registry = await openRegistry(source, { ...context, cache });
    const genuine = await registry.version("oxc", "1.0.0");
    const [integrity = ""] = [...entries.keys()];
    const trimmed = new Map(genuine.files);
    trimmed.delete("files/nested/notes.md");
    entries.set(integrity, { manifest: "{}", files: trimmed });
    const reopened = await openRegistry(source, { ...context, cache });
    const read = await reopened.version("oxc", "1.0.0");
    expect([...read.files.keys()].toSorted()).toEqual([...genuine.files.keys()].toSorted());
    expect(entries.get(integrity)?.files.size).toBe(genuine.files.size);
  } finally {
    await server.stop();
  }
});

test("a cache that fails to read or write never fails the version", async () => {
  const root = await builtFixtureRegistry();
  const server = serveRegistry(root);
  try {
    const cache: RegistryCache = {
      get: () => Promise.reject(new Error("cache read failed")),
      put: () => Promise.reject(new Error("cache write failed")),
    };
    const registry = await openRegistry(parseRegistrySource(server.url, sourceContext), {
      ...context,
      cache,
    });
    expect((await registry.version("oxc", "1.0.0")).manifest.name).toBe("oxc");
  } finally {
    await server.stop();
  }
});
