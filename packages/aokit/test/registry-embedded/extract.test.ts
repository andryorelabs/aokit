import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type EmbeddedRegistry,
  extractRegistryOrFail,
} from "../../src/registry/embedded/extract.ts";
import { RegistryError } from "../../src/registry/errors.ts";

const directories: string[] = [];

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aokit-extract-or-fail-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function sampleRegistry(): Promise<EmbeddedRegistry> {
  const sources = await scratch();
  await writeFile(join(sources, "a"), '{"index":true}');
  return { contentHash: "def456", files: [{ path: "index.json", source: join(sources, "a") }] };
}

describe("extractRegistryOrFail", () => {
  test("extracts once and returns the target directory", async () => {
    const cacheRoot = await scratch();
    const registry = await sampleRegistry();
    const first = await extractRegistryOrFail(registry, cacheRoot);
    const second = await extractRegistryOrFail(registry, cacheRoot);
    expect(second).toBe(first);
    expect(await readdir(join(cacheRoot, "bundled-registry"))).toEqual(["def456"]);
  });

  test("turns a filesystem failure into REGISTRY_EXTRACT_FAILED with the cause and a fix", async () => {
    const blocker = join(await scratch(), "not-a-directory");
    await writeFile(blocker, "file");
    const registry = await sampleRegistry();
    const error = await extractRegistryOrFail(registry, blocker).catch((thrown: unknown) => thrown);
    if (!(error instanceof RegistryError)) throw new Error("expected a RegistryError");
    const registryError = error;
    expect(registryError.code).toBe("REGISTRY_EXTRACT_FAILED");
    expect(registryError.message).toContain(join(blocker, "bundled-registry", "def456"));
    expect(registryError.message).toMatch(/ENOTDIR|EEXIST|not a directory/i);
    expect(registryError.fix).toContain("XDG_CACHE_HOME");
    expect(registryError.fix).not.toContain("registry:build");
  });
});
