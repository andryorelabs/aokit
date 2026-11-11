import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import {
  type EmbeddedRegistry,
  embeddedRegistryTarget,
  ensureEmbeddedRegistry,
  hasEmbeddedRegistry,
  registerEmbeddedRegistry,
  resetEmbeddedRegistry,
} from "../../src/registry/embedded/extract.ts";
import { RegistryError } from "../../src/registry/errors.ts";

const directories: string[] = [];
const relativeBundleName = "AOKIT_BUNDLED_REGISTRY_RELATIVE";

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aokit-embedded-state-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  resetEmbeddedRegistry();
  Reflect.deleteProperty(globalThis, relativeBundleName);
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function embeddedSample(contentHash: string): Promise<EmbeddedRegistry> {
  const sources = await scratch();
  await writeFile(join(sources, "a"), '{"index":true}');
  return { contentHash, files: [{ path: "index.json", source: join(sources, "a") }] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function freshBundled(label: string): Promise<{ bundledRegistryPath: string }> {
  const specifier = `../../src/registry/bundled.ts?${label}`;
  const loaded: unknown = await import(specifier);
  if (
    typeof loaded === "object" &&
    loaded !== null &&
    "bundledRegistryPath" in loaded &&
    typeof loaded.bundledRegistryPath === "string"
  ) {
    return { bundledRegistryPath: loaded.bundledRegistryPath };
  }
  throw new Error("bundled.ts did not export bundledRegistryPath");
}

describe("registration", () => {
  test("a process embeds a Registry only after one is registered", async () => {
    expect(hasEmbeddedRegistry()).toBe(false);
    registerEmbeddedRegistry(await embeddedSample("reg001"));
    expect(hasEmbeddedRegistry()).toBe(true);
    resetEmbeddedRegistry();
    expect(hasEmbeddedRegistry()).toBe(false);
  });

  test("the extraction target is the content hash under the cache directory", async () => {
    registerEmbeddedRegistry(await embeddedSample("reg002"));
    const cache = await scratch();
    expect(embeddedRegistryTarget({ XDG_CACHE_HOME: cache })).toBe(
      join(cache, "aokit", "bundled-registry", "reg002"),
    );
  });

  test("asking for the target of a build with no embedded Registry fails with REGISTRY_NOT_EMBEDDED", () => {
    expect(() => embeddedRegistryTarget({})).toThrow(AokitError);
    expect(() => embeddedRegistryTarget({})).toThrow("No Registry is embedded");
  });
});

describe("ensureEmbeddedRegistry", () => {
  test("is a no-op when nothing is embedded", async () => {
    const cache = await scratch();
    await ensureEmbeddedRegistry({ XDG_CACHE_HOME: cache });
    expect(await exists(join(cache, "aokit"))).toBe(false);
  });

  test("extracts the Registry to its target once per process", async () => {
    registerEmbeddedRegistry(await embeddedSample("reg003"));
    const cache = await scratch();
    const env = { XDG_CACHE_HOME: cache };
    const target = embeddedRegistryTarget(env);
    await ensureEmbeddedRegistry(env);
    expect(await exists(join(target, "index.json"))).toBe(true);
    await rm(target, { recursive: true, force: true });
    await ensureEmbeddedRegistry(env);
    expect(await exists(target)).toBe(false);
  });

  test("a failed extraction is reported and the next call tries again", async () => {
    registerEmbeddedRegistry(await embeddedSample("reg004"));
    const blocker = join(await scratch(), "not-a-directory");
    await writeFile(blocker, "file");
    const failure = await ensureEmbeddedRegistry({ XDG_CACHE_HOME: blocker }).catch(
      (thrown: unknown) => thrown,
    );
    expect(failure).toBeInstanceOf(RegistryError);
    expect(failure).toMatchObject({ code: "REGISTRY_EXTRACT_FAILED" });
    const cache = await scratch();
    const env = { XDG_CACHE_HOME: cache };
    await ensureEmbeddedRegistry(env);
    expect(await exists(join(embeddedRegistryTarget(env), "index.json"))).toBe(true);
  });
});

describe("bundledRegistryPath", () => {
  test("is the extraction target in a process that embeds a Registry", async () => {
    registerEmbeddedRegistry(await embeddedSample("reg005"));
    const { bundledRegistryPath } = await freshBundled("embedded");
    expect(bundledRegistryPath).toBe(embeddedRegistryTarget(process.env));
  });

  test("is resolved next to the module when the build defines a relative bundle path", async () => {
    Reflect.set(globalThis, relativeBundleName, "../bundle-elsewhere");
    const { bundledRegistryPath } = await freshBundled("relative");
    expect(bundledRegistryPath).toBe(join(import.meta.dir, "../../src/bundle-elsewhere"));
  });

  test("is the repository registry directory in the source", async () => {
    const { bundledRegistryPath } = await freshBundled("source");
    expect(bundledRegistryPath).toBe(join(import.meta.dir, "../../../../registry"));
  });
});
