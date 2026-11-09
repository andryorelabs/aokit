import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import {
  addMigrationToFixtureSource,
  writeRegistrySourceFixture,
} from "../../../../tools/registry-build/fixture.ts";
import { stableStringify } from "@aokit/module";
import { z } from "zod";
import { parseJsonRecord } from "../helpers/registry-json.ts";
import { registryIndexSchema } from "../../src/registry/schema.ts";
import {
  computeIntegrity,
  type LocalRegistry,
  readLocalRegistry,
  RegistryError,
} from "../../src/registry/index.ts";

const options = { cliVersion: "0.1.0" };
const loadedScriptSchema = z.object({
  default: z.custom<(input: unknown) => unknown>((value) => typeof value === "function"),
});
const registryIndexShape = z.looseObject({
  modules: z.record(
    z.string(),
    z.looseObject({ versions: z.record(z.string(), z.record(z.string(), z.unknown())) }),
  ),
});
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function builtRegistry(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const out = await mkdtemp(join(tmpdir(), "aokit-registry-"));
  temporaryDirectories.push(source, out);
  await buildRegistry(source, out);
  return out;
}

async function editJson(
  path: string,
  edit: (value: Record<string, unknown>) => void,
): Promise<void> {
  const value = parseJsonRecord(await readFile(path, "utf8"));
  edit(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

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

test("reads a built Registry: name, Release, Catalog, manifests and files", async () => {
  const registry: LocalRegistry = await readLocalRegistry(await builtRegistry(), options);
  expect(registry.name).toBe("official");
  expect(registry.release).toBe("2026.11.0");
  expect(registry.currentCatalog.dependencies["oxlint"]).toBe("1.90.0");
  expect([...registry.modules.keys()]).toEqual(["knip", "oxc"]);
  const oxc = registry.modules.get("oxc");
  expect(oxc?.manifest.version).toBe("1.0.0");
  expect([...(oxc?.files.keys() ?? [])]).toEqual(["files/.oxlintrc.json", "files/nested/notes.md"]);
  expect(oxc?.files.get("files/nested/notes.md")).toBe("# {{name}}\n");
});

test("a Module file modified after build fails integrity naming oxc, expected and actual hash", async () => {
  const root = await builtRegistry();
  const filePath = join(root, "modules/oxc/1.0.0/files/.oxlintrc.json");
  const expected = computeIntegrity(await readFile(filePath, "utf8"));
  const tampered = '{ "ignorePatterns": ["tampered"] }\n';
  await writeFile(filePath, tampered, "utf8");

  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.message).toContain("oxc");
  expect(error.message).toContain(`expected ${expected}`);
  expect(error.message).toContain(`actual ${computeIntegrity(tampered)}`);
  expect(error.fix).toContain("registry:build");
});

test("a modified manifest fails integrity", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "modules/knip/2.1.0/module.json"), (manifest) => {
    manifest["requires"] = [];
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.message).toContain("knip@2.1.0");
});

test("a modified Catalog fails integrity", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "catalog/2026.11.0.json"), (catalog) => {
    catalog["dependencies"] = {};
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.message).toContain("Catalog");
});

test("an index release that differs from the Catalog release fails", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "index.json"), (index) => {
    const parsed = z.looseObject({ releases: z.record(z.string(), z.unknown()) }).parse(index);
    index["release"] = "2027.1.0";
    index["releases"] = { "2027.1.0": parsed.releases["2026.11.0"] };
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_RELEASE_MISMATCH");
  expect(error.message).toContain("expected 2027.1.0, actual 2026.11.0");
  expect(error.fix).toContain("2027.1.0");
});

test("a minCliVersion above the CLI version fails telling the user to update the CLI", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "index.json"), (index) => {
    index["minCliVersion"] = "0.2.0";
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_CLI_TOO_OLD");
  expect(error.message).toContain('"official"');
  expect(error.message).toContain("expected >= 0.2.0, actual 0.1.0");
  expect(error.fix).toContain("Update the aokit CLI");
  expect(error.fix).toContain("bunx aokit@0.2.0");
  expect(error.fix).toContain("https://github.com/andryorelabs/aokit/releases");
});

test("a pre-release CLI of the minCliVersion core version reads the Registry", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "index.json"), (index) => {
    index["minCliVersion"] = "0.1.0";
  });
  const registry = await readLocalRegistry(root, { cliVersion: "0.1.0-next.0" });
  expect(registry.name).toBe("official");
});

test("a pre-release CLI below the minCliVersion core version still fails", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "index.json"), (index) => {
    index["minCliVersion"] = "0.2.0";
  });
  const error = await captureError(() => readLocalRegistry(root, { cliVersion: "0.1.0-next.0" }));
  expect(error.code).toBe("REGISTRY_CLI_TOO_OLD");
  expect(error.message).toContain("expected >= 0.2.0, actual 0.1.0-next.0");
});

test("a CLI at or above minCliVersion reads the Registry", async () => {
  const root = await builtRegistry();
  const registry = await readLocalRegistry(root, { cliVersion: "1.0.0" });
  expect(registry.modules.size).toBe(2);
});

test("a newer index schemaVersion fails telling the user to update the CLI", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "index.json"), (index) => {
    index["schemaVersion"] = 2;
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_SCHEMA_TOO_NEW");
  expect(error.fix).toContain("Update the aokit CLI");
});

test("an index with unknown fields or an escaping path is invalid", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "index.json"), (index) => {
    index["extra"] = true;
    index["releases"] = {
      "2026.11.0": { path: "../catalog.json", integrity: computeIntegrity("") },
    };
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INDEX_INVALID");
  expect(error.message).toContain("releases.2026.11.0.path");
});

test("a provides summary that disagrees with the manifest fails", async () => {
  const root = await builtRegistry();
  await editJson(join(root, "index.json"), (index) => {
    const parsed = registryIndexShape.parse(index);
    const entry = parsed.modules["knip"]?.versions["2.1.0"];
    if (entry !== undefined) {
      entry["provides"] = ["lint"];
    }
    index["modules"] = parsed.modules;
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_SUMMARY_MISMATCH");
  expect(error.message).toContain("knip@2.1.0");
  expect(error.message).toContain("expected [lint], actual [unused-code]");
});

test("a missing Module file fails naming the file", async () => {
  const root = await builtRegistry();
  await rm(join(root, "modules/oxc/1.0.0/files/nested/notes.md"));
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_FILE_MISSING");
  expect(error.message).toContain("files/nested/notes.md");
});

test("a directory without index.json is not a Registry", async () => {
  const root = await mkdtemp(join(tmpdir(), "aokit-registry-empty-"));
  temporaryDirectories.push(root);
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_NOT_FOUND");
});

async function migrationRegistry(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const root = await mkdtemp(join(tmpdir(), "aokit-registry-"));
  temporaryDirectories.push(source, root);
  await addMigrationToFixtureSource(source);
  await buildRegistry(source, root);
  return root;
}

test("the reader exposes a version's migration scripts and renames", async () => {
  const root = await migrationRegistry();
  const registry = await readLocalRegistry(root, options);
  const oxc = registry.version("oxc", "2.0.0");
  expect(oxc?.manifest.migrations).toEqual([
    { from: ">=1 <2", to: "2.0.0", stage: "before", script: "migrations/1-to-2.before.js" },
  ]);
  expect(oxc?.renames).toEqual({ "src/routes.tsx": "src/router.tsx" });
  const scriptPath = oxc?.migrationScript("migrations/1-to-2.before.js") ?? "";
  expect(isAbsolute(scriptPath)).toBe(true);
  expect(scriptPath).toBe(join(root, "modules/oxc/2.0.0/migrations/1-to-2.before.js"));
  const loaded = loadedScriptSchema.parse(await import(scriptPath));
  expect(loaded.default({ answers: { appRouter: "tanstack" } })).toEqual({ router: "tanstack" });
  expect(() => oxc?.migrationScript("migrations/missing.js")).toThrow(RegistryError);
  expect(registry.version("knip", "2.1.0")?.renames).toEqual({});
});

test("one changed byte of a built migration script fails integrity", async () => {
  const root = await migrationRegistry();
  const scriptPath = join(root, "modules/oxc/2.0.0/migrations/1-to-2.before.js");
  await writeFile(scriptPath, `${await readFile(scriptPath, "utf8")}// x\n`, "utf8");
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.message).toContain("migrations/1-to-2.before.js");
});

test("an invalid renames.json fails naming the file", async () => {
  const source = await writeRegistrySourceFixture();
  const root = await mkdtemp(join(tmpdir(), "aokit-registry-"));
  temporaryDirectories.push(source, root);
  await addMigrationToFixtureSource(source);
  await writeFile(join(source, "oxc/renames.json"), '{ "a": 1 }\n', "utf8");
  await buildRegistry(source, root);
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
  expect(error.message).toContain("renames.json");
});

test("the committed first-party Registry reads cleanly", async () => {
  const registry = await readLocalRegistry(join(import.meta.dir, "../../../../registry"), options);
  expect(registry.name).toBe("official");
  expect(registry.release).toBe("2026.12.0");
  expect(registry.currentCatalog.release).toBe("2026.12.0");
});

async function bumpedRegistry(): Promise<string> {
  const source = await writeRegistrySourceFixture();
  const root = await mkdtemp(join(tmpdir(), "aokit-registry-"));
  temporaryDirectories.push(source, root);
  await buildRegistry(source, root);
  const bumped = await writeRegistrySourceFixture();
  temporaryDirectories.push(bumped);
  const modulePath = join(bumped, "oxc/module.ts");
  await writeFile(
    modulePath,
    (await readFile(modulePath, "utf8")).replace('version: "1.0.0"', 'version: "1.1.0"'),
    "utf8",
  );
  await writeFile(
    join(bumped, "catalog/2026.12.0.json"),
    `${JSON.stringify({ release: "2026.12.0", dependencies: { oxfmt: "0.76.0", oxlint: "1.91.0" } })}\n`,
    "utf8",
  );
  await buildRegistry(bumped, root);
  return root;
}

test("looks up Module versions by name@version and lists them in semver order", async () => {
  const registry = await readLocalRegistry(await bumpedRegistry(), options);
  expect(registry.versions("oxc")).toEqual(["1.0.0", "1.1.0"]);
  expect(registry.versions("knip")).toEqual(["2.1.0"]);
  expect(registry.versions("missing")).toEqual([]);
  expect(registry.modules.get("oxc")?.manifest.version).toBe("1.1.0");
  expect(registry.version("oxc", "1.0.0")?.manifest.version).toBe("1.0.0");
  expect(registry.version("oxc", "9.9.9")).toBeUndefined();
  expect(registry.version("missing", "1.0.0")).toBeUndefined();
});

test("the version integrity equals the index integrity, the form the Lockfile records", async () => {
  const root = await bumpedRegistry();
  const registry = await readLocalRegistry(root, options);
  const index = registryIndexShape.parse(
    JSON.parse(await readFile(join(root, "index.json"), "utf8")),
  );
  for (const version of ["1.0.0", "1.1.0"]) {
    const published = index.modules["oxc"]?.versions[version]?.["integrity"];
    const actual: unknown = registry.version("oxc", version)?.integrity;
    expect(actual).toBe(published);
    expect(published).toMatch(/^sha256-[0-9a-f]{64}$/);
  }
});

test("looks up the Catalog of every published Release", async () => {
  const registry = await readLocalRegistry(await bumpedRegistry(), options);
  expect(registry.releases()).toEqual(["2026.11.0", "2026.12.0"]);
  expect(registry.catalog("2026.11.0")?.dependencies["oxlint"]).toBe("1.90.0");
  expect(registry.catalog("2026.12.0")?.dependencies["oxlint"]).toBe("1.91.0");
  expect(registry.catalog("2030.1.0")).toBeUndefined();
});

test("a hand-edited file of an older version fails integrity naming Registry, Module and both values", async () => {
  const root = await bumpedRegistry();
  const filePath = join(root, "modules/oxc/1.0.0/files/nested/notes.md");
  const expected = computeIntegrity(await readFile(filePath, "utf8"));
  await writeFile(filePath, "edited\n", "utf8");
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.message).toContain('Registry "official"');
  expect(error.message).toContain("oxc@1.0.0");
  expect(error.message).toContain(`expected ${expected}`);
  expect(error.message).toContain(`actual ${computeIntegrity("edited\n")}`);
});

test("each Release Catalog carries the Module versions that Release ships", async () => {
  const registry = await readLocalRegistry(await bumpedRegistry(), options);
  expect(registry.catalog("2026.11.0")?.modules).toEqual({ knip: "2.1.0", oxc: "1.0.0" });
  expect(registry.catalog("2026.12.0")?.modules).toEqual({ knip: "2.1.0", oxc: "1.1.0" });
  expect(registry.currentCatalog.modules).toEqual({ knip: "2.1.0", oxc: "1.1.0" });
});

test("a Catalog mapping a Module to a version the index does not list is invalid", async () => {
  const root = await builtRegistry();
  const catalogPath = join(root, "catalog/2026.11.0.json");
  await editJson(catalogPath, (value) => {
    value["modules"] = { oxc: "9.9.9" };
  });
  const text = await readFile(catalogPath, "utf8");
  await editJson(join(root, "index.json"), (value) => {
    const releases = z
      .record(z.string(), z.looseObject({ integrity: z.string() }))
      .parse(value["releases"]);
    const pointer = releases["2026.11.0"];
    if (pointer === undefined) throw new Error("release missing");
    value["releases"] = {
      ...releases,
      "2026.11.0": { ...pointer, integrity: computeIntegrity(text) },
    };
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_CATALOG_INVALID");
  expect(error.message).toContain("oxc");
  expect(error.message).toContain("9.9.9");
});

async function yankedRegistry(yanked: string[]): Promise<string> {
  const root = await bumpedRegistry();
  const source = await writeRegistrySourceFixture();
  temporaryDirectories.push(source);
  const modulePath = join(source, "oxc/module.ts");
  await writeFile(
    modulePath,
    (await readFile(modulePath, "utf8")).replace('version: "1.0.0"', 'version: "1.1.0"'),
    "utf8",
  );
  await writeFile(join(source, "yanked.json"), JSON.stringify(yanked), "utf8");
  await writeFile(
    join(source, "catalog/2026.12.0.json"),
    `${JSON.stringify({ release: "2026.12.0", dependencies: { oxfmt: "0.76.0", oxlint: "1.91.0" } })}\n`,
    "utf8",
  );
  await buildRegistry(source, root);
  return root;
}

test("a Yanked version is never latest, never selectable, but is still served and verified", async () => {
  const root = await yankedRegistry(["oxc@1.1.0"]);
  const registry = await readLocalRegistry(root, options);
  const index = registryIndexShape.parse(
    JSON.parse(await readFile(join(root, "index.json"), "utf8")),
  );
  expect(index.modules["oxc"]?.versions["1.1.0"]?.["yanked"]).toBe(true);
  expect(index.modules["oxc"]?.versions["1.0.0"]?.["yanked"]).toBeUndefined();
  expect(registry.modules.get("oxc")?.manifest.version).toBe("1.0.0");
  expect(registry.selectableVersions("oxc")).toEqual(["1.0.0"]);
  expect(registry.versions("oxc")).toEqual(["1.0.0", "1.1.0"]);
  expect(registry.version("oxc", "1.1.0")?.manifest.version).toBe("1.1.0");
});

test("a Yanked version still fails integrity when its file is tampered", async () => {
  const root = await yankedRegistry(["oxc@1.1.0"]);
  await writeFile(join(root, "modules/oxc/1.1.0/files/.oxlintrc.json"), "{}\n", "utf8");
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
});

test("removing a version from yanked.json restores it as latest", async () => {
  const root = await yankedRegistry([]);
  const registry = await readLocalRegistry(root, options);
  expect(registry.modules.get("oxc")?.manifest.version).toBe("1.1.0");
  expect(registry.selectableVersions("oxc")).toEqual(["1.0.0", "1.1.0"]);
});

test("yanked.json naming an unbuilt version fails the build", async () => {
  const failure = await yankedRegistry(["oxc@9.9.9"]).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(String(failure)).toContain("oxc@9.9.9");
});

test("the index schema accepts yanked: true only", async () => {
  const root = await yankedRegistry(["oxc@1.1.0"]);
  const indexPath = join(root, "index.json");
  const text = await readFile(indexPath, "utf8");
  await writeFile(indexPath, text.replace('"yanked": true', '"yanked": false'), "utf8");
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INDEX_INVALID");
});

test("the committed Registry JSON Schema matches the Zod index schema", async () => {
  const committed = await readFile(
    join(import.meta.dir, "../../../../schema/registry/v1.json"),
    "utf8",
  );
  expect(committed).toBe(stableStringify(z.toJSONSchema(registryIndexSchema, { io: "input" })));
});
