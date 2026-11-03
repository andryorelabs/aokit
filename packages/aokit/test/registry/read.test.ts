import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { z } from "zod";
import {
  computeIntegrity,
  type LocalRegistry,
  readLocalRegistry,
  RegistryError,
} from "../../src/registry/index.ts";

const options = { cliVersion: "0.1.0" };
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
  const value = JSON.parse(await readFile(path, "utf8"));
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
  expect(registry.catalog.dependencies["oxlint"]).toBe("1.90.0");
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
  await editJson(join(root, "modules/knip/2.1.0.json"), (manifest) => {
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
    index["release"] = "2027.1.0";
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
    index["catalog"] = { path: "../catalog.json", integrity: computeIntegrity("") };
  });
  const error = await captureError(() => readLocalRegistry(root, options));
  expect(error.code).toBe("REGISTRY_INDEX_INVALID");
  expect(error.message).toContain("catalog.path");
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

test("the committed first-party Registry reads cleanly", async () => {
  const registry = await readLocalRegistry(join(import.meta.dir, "../../../../registry"), options);
  expect(registry.name).toBe("official");
  expect(registry.release).toBe("2026.11.0");
  expect(registry.catalog.release).toBe("2026.11.0");
});
