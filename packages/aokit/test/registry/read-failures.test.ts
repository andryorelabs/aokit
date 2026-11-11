import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import {
  addMigrationToFixtureSource,
  writeRegistrySourceFixture,
} from "../../../../tools/registry-build/fixture.ts";
import { parseJsonRecord } from "../helpers/registry-json.ts";
import {
  computeIntegrity,
  computeModuleIntegrity,
  readLocalRegistry,
  RegistryError,
} from "../../src/registry/index.ts";

const options = { cliVersion: "0.1.0" };
const temporaryDirectories: string[] = [];
const releaseName = "2026.11.0";
const moduleDirectory = "modules/oxc/2.0.0";

const indexShape = z.looseObject({
  releases: z.record(z.string(), z.looseObject({ integrity: z.string(), path: z.string() })),
  modules: z.record(
    z.string(),
    z.looseObject({
      versions: z.record(
        z.string(),
        z.looseObject({
          files: z.record(z.string(), z.string()),
          integrity: z.string(),
          manifest: z.string(),
          schemaVersion: z.number(),
        }),
      ),
    }),
  ),
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function migrationRegistry(
  prepareSource: (source: string) => Promise<void> = async () => {},
): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const out = await mkdtemp(join(tmpdir(), "aokit-registry-failures-"));
  temporaryDirectories.push(source, out);
  await addMigrationToFixtureSource(source);
  await prepareSource(source);
  await buildRegistry(source, out);
  return out;
}

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

async function captureRegistryError(root: string): Promise<RegistryError> {
  const error = await captureError(() => readLocalRegistry(root, options));
  if (!(error instanceof RegistryError)) {
    throw new Error("expected a RegistryError", { cause: error });
  }
  return error;
}

async function readIndex(root: string): Promise<z.output<typeof indexShape>> {
  return indexShape.parse(parseJsonRecord(await readFile(join(root, "index.json"), "utf8")));
}

async function writeIndex(root: string, index: z.output<typeof indexShape>): Promise<void> {
  await writeFile(join(root, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

interface ModuleRewrite {
  readonly manifestText?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly schemaVersion?: number;
}

async function rewriteOxc(root: string, rewrite: ModuleRewrite): Promise<void> {
  const index = await readIndex(root);
  const entry = index.modules["oxc"]?.versions["2.0.0"];
  if (entry === undefined) throw new Error("oxc@2.0.0 missing from the fixture");
  const manifestPath = join(root, entry.manifest);
  const manifestText = rewrite.manifestText ?? (await readFile(manifestPath, "utf8"));
  await writeFile(manifestPath, manifestText, "utf8");
  await Promise.all(
    Object.entries(rewrite.files ?? {}).map(([path, text]) =>
      writeFile(join(root, moduleDirectory, path), text, "utf8"),
    ),
  );
  const files = new Map(
    await Promise.all(
      Object.keys(entry.files).map(
        async (path) => [path, await readFile(join(root, moduleDirectory, path), "utf8")] as const,
      ),
    ),
  );
  entry.files = Object.fromEntries(
    [...files].map(([path, text]) => [path, computeIntegrity(text)]),
  );
  entry.integrity = computeModuleIntegrity(manifestText, files);
  entry.schemaVersion = rewrite.schemaVersion ?? entry.schemaVersion;
  await writeIndex(root, index);
}

async function editOxcManifest(
  root: string,
  edit: (manifest: Record<string, unknown>) => void,
  rewrite: Omit<ModuleRewrite, "manifestText"> = {},
): Promise<void> {
  const manifest = parseJsonRecord(
    await readFile(join(root, moduleDirectory, "module.json"), "utf8"),
  );
  edit(manifest);
  await rewriteOxc(root, { ...rewrite, manifestText: `${JSON.stringify(manifest, null, 2)}\n` });
}

async function replaceCatalog(root: string, text: string): Promise<void> {
  const index = await readIndex(root);
  const pointer = index.releases[releaseName];
  if (pointer === undefined) throw new Error("fixture release missing");
  await writeFile(join(root, pointer.path), text, "utf8");
  pointer.integrity = computeIntegrity(text);
  await writeIndex(root, index);
}

describe("index", () => {
  test("an index.json that cannot be read for a reason other than absence rethrows that error", async () => {
    const root = await mkdtemp(join(tmpdir(), "aokit-registry-failures-"));
    temporaryDirectories.push(root);
    await mkdir(join(root, "index.json"));
    const error = await captureError(() => readLocalRegistry(root, options));
    expect(error).not.toBeInstanceOf(RegistryError);
    expect(error).toMatchObject({ code: "EISDIR" });
  });

  test("an index that is not JSON fails as REGISTRY_INDEX_INVALID with the parser reason", async () => {
    const root = await migrationRegistry();
    await writeFile(join(root, "index.json"), "{ not json", "utf8");
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_INDEX_INVALID");
    expect(error.message).toContain("is not valid JSON");
    expect(error.fix).toContain("registry:build");
  });

  test("an index that is JSON but not an object fails schema validation at the root", async () => {
    const root = await migrationRegistry();
    await writeFile(join(root, "index.json"), "[]\n", "utf8");
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_INDEX_INVALID");
    expect(error.message).toContain("is invalid");
  });
});

describe("Catalog", () => {
  test("a Catalog pointer to a file that does not exist fails as REGISTRY_FILE_MISSING", async () => {
    const root = await migrationRegistry();
    const index = await readIndex(root);
    const pointer = index.releases[releaseName];
    if (pointer === undefined) throw new Error("fixture release missing");
    pointer.path = "catalog/absent.json";
    await writeIndex(root, index);
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_FILE_MISSING");
    expect(error.message).toContain("catalog/absent.json");
    expect(error.message).toContain("is missing");
  });

  test("a Catalog that is not JSON fails as REGISTRY_CATALOG_INVALID once its integrity matches", async () => {
    const root = await migrationRegistry();
    await replaceCatalog(root, "{ broken");
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
    expect(error.message).toContain("is not valid JSON");
    expect(error.fix).toContain("Catalog source");
  });

  test("a Catalog that is not an object fails as REGISTRY_CATALOG_INVALID", async () => {
    const root = await migrationRegistry();
    await replaceCatalog(root, "[]\n");
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
    expect(error.message).toContain("is invalid");
  });

  test("a Catalog with only a bad dependency map reports no Module map problem", async () => {
    const root = await migrationRegistry();
    await replaceCatalog(
      root,
      `${JSON.stringify({ release: releaseName, dependencies: { oxlint: 1 }, modules: {} })}\n`,
    );
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
    expect(error.message).not.toContain("modules:");
  });

  test("a Catalog with a bad dependency map and a bad Module map reports both problems", async () => {
    const root = await migrationRegistry();
    await replaceCatalog(
      root,
      `${JSON.stringify({ release: releaseName, dependencies: { oxlint: 1 }, modules: { oxc: "latest" } })}\n`,
    );
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
    expect(error.message).toContain("is invalid");
    expect(error.message).toContain("modules:");
  });
});

describe("Module manifest", () => {
  test("a manifest that is not JSON fails as REGISTRY_MANIFEST_INVALID", async () => {
    const root = await migrationRegistry();
    await rewriteOxc(root, { manifestText: "{ not json" });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
    expect(error.message).toContain("oxc@2.0.0 manifest is not valid JSON");
    expect(error.fix).toContain("Fix the Module source");
  });

  test("a manifest the schema rejects tells the author to fix the Module source", async () => {
    const root = await migrationRegistry();
    await editOxcManifest(root, (manifest) => {
      manifest["unknownField"] = true;
    });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
    expect(error.message).toContain("manifest is invalid");
    expect(error.fix).toContain("Fix the Module source");
  });

  test("a manifest with a newer schemaVersion tells the user to update the CLI", async () => {
    const root = await migrationRegistry();
    await editOxcManifest(
      root,
      (manifest) => {
        manifest["schemaVersion"] = 99;
      },
      { schemaVersion: 99 },
    );
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
    expect(error.fix).toContain("Update the aokit CLI to read this Module");
  });

  test("a manifest whose name differs from the index key fails as REGISTRY_SUMMARY_MISMATCH", async () => {
    const root = await migrationRegistry();
    await editOxcManifest(root, (manifest) => {
      manifest["name"] = "other";
    });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_SUMMARY_MISMATCH");
    expect(error.message).toContain("on name: expected oxc, actual other");
  });

  test("a manifest whose version differs from the index key fails as REGISTRY_SUMMARY_MISMATCH", async () => {
    const root = await migrationRegistry();
    await editOxcManifest(root, (manifest) => {
      manifest["version"] = "2.0.1";
    });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_SUMMARY_MISMATCH");
    expect(error.message).toContain("on version: expected 2.0.0, actual 2.0.1");
  });

  test("an index schemaVersion that differs from the manifest fails as REGISTRY_SUMMARY_MISMATCH", async () => {
    const root = await migrationRegistry();
    await rewriteOxc(root, { schemaVersion: 2 });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_SUMMARY_MISMATCH");
    expect(error.message).toContain("on schemaVersion: expected 2, actual 1");
  });

  test("a manifest file the index does not record fails naming that file", async () => {
    const root = await migrationRegistry();
    await editOxcManifest(root, (manifest) => {
      manifest["files"] = [{ from: "files/unrecorded.txt", to: "unrecorded.txt", target: "root" }];
    });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_FILE_MISSING");
    expect(error.message).toContain("lists files/unrecorded.txt, which the index does not record");
    expect(error.fix).toContain("files/");
  });

  test("a manifest migration script the index does not record fails naming that script", async () => {
    const root = await migrationRegistry();
    await editOxcManifest(root, (manifest) => {
      manifest["migrations"] = [
        { from: ">=1 <2", to: "2.0.0", stage: "before", script: "migrations/unrecorded.js" },
      ];
    });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_FILE_MISSING");
    expect(error.message).toContain("migration script migrations/unrecorded.js");
    expect(error.fix).toContain("migrations/");
  });

  test("a renames.json that is not JSON fails as REGISTRY_MANIFEST_INVALID", async () => {
    const root = await migrationRegistry();
    await rewriteOxc(root, { files: { "renames.json": "{ not json" } });
    const error = await captureRegistryError(root);
    expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
    expect(error.message).toContain("renames.json is not valid JSON");
    expect(error.fix).toContain("Fix the Module source");
  });
});
