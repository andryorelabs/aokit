import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { errorCodeExitCodes, exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { toAokitError } from "../../src/project/errors.ts";
import {
  type CachedModuleVersion,
  formatRegistrySource,
  type ModuleVersion,
  openRegistry,
  parseRegistrySource,
  type Registry,
  type RegistryCache,
  RegistryError,
  type RegistryErrorData,
  type RegistrySource,
} from "../../src/registry/index.ts";
import { xdgCacheDir, xdgConfigDir } from "../../src/xdg.ts";
import {
  builtFixtureRegistry,
  removeTemporaryDirectories,
  serveRegistry,
} from "../registry-remote/served-registry.ts";

const bundledRegistryPath = resolve(import.meta.dir, "..", "..", "..", "..", "registry");
const context = { cliVersion: "0.1.0" };
const sourceContext = { projectDir: "/work/app", bundledRegistryPath };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  await removeTemporaryDirectories();
});

async function copyOfBundled(): Promise<string> {
  const copy = await mkdtemp(join(tmpdir(), "aokit-registry-copy-"));
  temporaryDirectories.push(copy);
  await cp(bundledRegistryPath, copy, { recursive: true });
  return copy;
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

function memoryCache(): RegistryCache & {
  entries: Map<string, CachedModuleVersion>;
  puts: number;
} {
  const entries = new Map<string, CachedModuleVersion>();
  const cache = {
    entries,
    puts: 0,
    get: async (integrity: string) => entries.get(integrity),
    put: async (integrity: string, files: CachedModuleVersion) => {
      cache.puts += 1;
      entries.set(integrity, files);
    },
  };
  return cache;
}

test("the bundled Registry and a local copy of it return identical Modules and integrities", async () => {
  const bundled = await openRegistry(parseRegistrySource("bundled", sourceContext), context);
  const local = await openRegistry(
    parseRegistrySource(await copyOfBundled(), sourceContext),
    context,
  );
  expect(bundled.source.kind).toBe("bundled");
  expect(local.source.kind).toBe("local");
  expect(local.name).toBe(bundled.name);
  expect(local.release).toBe(bundled.release);
  expect(local.index).toEqual(bundled.index);
  expect(local.currentCatalog).toEqual(bundled.currentCatalog);
  const names = Object.keys(bundled.index.modules);
  expect(names.length).toBeGreaterThan(0);
  const pairs = names.flatMap((name) => {
    expect(local.versions(name)).toEqual(bundled.versions(name));
    return bundled.versions(name).map((version) => ({ name, version }));
  });
  const read = await Promise.all(
    pairs.map(async ({ name, version }) => ({
      expected: bundled.index.modules[name]?.versions[version]?.integrity,
      fromBundled: await bundled.version(name, version),
      fromLocal: await local.version(name, version),
    })),
  );
  for (const { expected, fromBundled, fromLocal } of read) {
    expect(fromLocal.integrity).toBe(fromBundled.integrity);
    expect<string | undefined>(fromLocal.integrity).toBe(expected);
    expect(fromLocal.manifest).toEqual(fromBundled.manifest);
    expect([...fromLocal.files]).toEqual([...fromBundled.files]);
    expect(fromLocal.renames).toEqual(fromBundled.renames);
  }
  const releases = bundled.releases();
  expect(await Promise.all(releases.map((release) => local.catalog(release)))).toEqual(
    await Promise.all(releases.map((release) => bundled.catalog(release))),
  );
});

test("a tampered Module file fails with REGISTRY_INTEGRITY_MISMATCH naming the Registry, the Module and both values", async () => {
  const copy = await copyOfBundled();
  const registry: Registry = await openRegistry({ kind: "local", path: copy }, context);
  const [name, moduleEntry] = Object.entries(registry.index.modules).find(
    ([, entry]) => Object.keys(entry.versions[entry.latest]?.files ?? {}).length > 0,
  ) ?? ["", undefined];
  const version = moduleEntry?.latest ?? "";
  const [path = "", expected = ""] =
    Object.entries(moduleEntry?.versions[version]?.files ?? {})[0] ?? [];
  await writeFile(join(copy, "modules", name, version, path), "tampered\n", "utf8");
  const error = await captureError(() => registry.version(name, version));
  const data: RegistryErrorData = error.data;
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.message).toContain(`Registry "${registry.name}"`);
  expect(error.message).toContain(`${name}@${version}`);
  expect(error.message).toContain(expected);
  expect(data).toMatchObject({
    registry: registry.name,
    module: `${name}@${version}`,
    expected,
  });
  expect(error.data.actual).toMatch(/^sha256-[0-9a-f]{64}$/);
  expect(error.message).toContain(error.data.actual ?? "");
  const mapped = toAokitError(error);
  expect(mapped).toBeInstanceOf(AokitError);
  if (mapped instanceof AokitError) {
    expect(mapped.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
    expect(exitCodeForErrorCode(mapped.code)).toBe(1);
    expect(mapped.data).toMatchObject({ module: `${name}@${version}`, expected });
  }
});

test("opening a Registry reads no Module, so a tampered Module fails only when it is read", async () => {
  const root = await builtFixtureRegistry();
  await writeFile(join(root, "modules/knip/2.1.0/module.json"), "{}\n", "utf8");
  const registry = await openRegistry({ kind: "local", path: root }, context);
  expect((await registry.version("oxc", "1.0.0")).manifest.name).toBe("oxc");
  expect((await captureError(() => registry.version("knip", "2.1.0"))).code).toBe(
    "REGISTRY_INTEGRITY_MISMATCH",
  );
});

test("a version the index does not publish fails with REGISTRY_MODULE_NOT_FOUND", async () => {
  const registry = await openRegistry(
    { kind: "local", path: await builtFixtureRegistry() },
    context,
  );
  const error = await captureError(() => registry.version("oxc", "9.9.9"));
  expect(error.code).toBe("REGISTRY_MODULE_NOT_FOUND");
  expect(error.fix).toContain("1.0.0");
  const mapped = toAokitError(error);
  expect(mapped instanceof AokitError && mapped.code).toBe("MODULE_VERSION_UNAVAILABLE");
  expect(registry.versions("missing")).toEqual([]);
  expect(await registry.catalog("1999.1.0")).toBeUndefined();
});

test("a cache hit is verified and served without fetching", async () => {
  const root = await builtFixtureRegistry();
  const server = serveRegistry(root);
  try {
    const cache = memoryCache();
    const source = parseRegistrySource(server.url, sourceContext);
    const first = await openRegistry(source, { ...context, cache });
    await first.version("oxc", "1.0.0");
    expect(cache.puts).toBe(1);
    const second = await openRegistry(source, { ...context, cache });
    const requestsBefore = server.requests.length;
    const cached: ModuleVersion = await second.version("oxc", "1.0.0");
    expect(server.requests.length).toBe(requestsBefore);
    expect<string>(cached.integrity).toBe(
      second.index.modules.oxc?.versions["1.0.0"]?.integrity ?? "",
    );
    expect(cache.puts).toBe(1);
  } finally {
    await server.stop();
  }
});

test("a tampered cache entry is never used: the version is fetched, verified and put again", async () => {
  const root = await builtFixtureRegistry();
  const server = serveRegistry(root);
  try {
    const cache = memoryCache();
    const source = parseRegistrySource(server.url, sourceContext);
    const registry = await openRegistry(source, { ...context, cache });
    const integrity = registry.index.modules.oxc?.versions["1.0.0"]?.integrity ?? "sha256-";
    const genuine = await registry.version("oxc", "1.0.0");
    const tamperedFiles = new Map(genuine.files);
    tamperedFiles.set("files/nested/notes.md", "# tampered\n");
    const original = cache.entries.get(integrity);
    cache.entries.set(integrity, { manifest: original?.manifest ?? "", files: tamperedFiles });
    const reopened = await openRegistry(source, { ...context, cache });
    const requestsBefore = server.requests.length;
    const read = await reopened.version("oxc", "1.0.0");
    expect(read.files.get("files/nested/notes.md")).toBe("# {{name}}\n");
    expect(server.requests.length).toBeGreaterThan(requestsBefore);
    expect(cache.puts).toBe(2);
    expect(cache.entries.get(integrity)?.files.get("files/nested/notes.md")).toBe("# {{name}}\n");
  } finally {
    await server.stop();
  }
});

test("a github: source parses but cannot be opened until GitHub support lands", async () => {
  const source: RegistrySource = parseRegistrySource("github:acme/mods#main", sourceContext);
  expect(source).toEqual({ kind: "github", owner: "acme", repo: "mods", ref: "main" });
  expect(formatRegistrySource(source)).toBe("github:acme/mods#main");
  const error = await captureError(() => openRegistry(source, context));
  expect(error.code).toBe("REGISTRY_SOURCE_UNSUPPORTED");
  const mapped = toAokitError(error);
  expect(mapped instanceof AokitError && mapped.code).toBe("INVALID_INPUT");
});

test("parseRegistrySource accepts bundled, paths, file: and https: sources", () => {
  expect(parseRegistrySource("bundled", sourceContext)).toEqual({
    kind: "bundled",
    path: bundledRegistryPath,
  });
  expect(parseRegistrySource("../registry", sourceContext)).toEqual({
    kind: "local",
    path: "/work/registry",
  });
  expect(parseRegistrySource("/srv/registry", sourceContext)).toEqual({
    kind: "local",
    path: "/srv/registry",
  });
  expect(parseRegistrySource("file:///srv/registry", sourceContext)).toEqual({
    kind: "local",
    path: "/srv/registry",
  });
  const url = parseRegistrySource("https://r.test/base/", sourceContext);
  expect(url).toEqual({ kind: "url", url: "https://r.test/base" });
  expect(formatRegistrySource(url)).toBe("https://r.test/base");
  expect(parseRegistrySource("http://127.0.0.1:4000", sourceContext)).toEqual({
    kind: "url",
    url: "http://127.0.0.1:4000",
  });
});

for (const rejected of [
  "http://r.test/registry",
  "ftp://r.test/registry",
  "https://user:secret@r.test/registry",
  "https://r.test/registry?token=1",
  "github:acme",
  "github:acme/mods",
  "",
]) {
  test(`parseRegistrySource rejects "${rejected}"`, () => {
    let caught: unknown;
    try {
      parseRegistrySource(rejected, sourceContext);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RegistryError);
    expect(caught instanceof RegistryError && caught.code).toBe("REGISTRY_SOURCE_UNSUPPORTED");
  });
}

test("the new Registry error codes map to their stable exit codes", () => {
  expect(errorCodeExitCodes.REGISTRY_UNTRUSTED).toBe(5);
  expect(errorCodeExitCodes.REGISTRY_FETCH_FAILED).toBe(1);
  expect(errorCodeExitCodes.REGISTRY_INTEGRITY_MISMATCH).toBe(1);
  const untrusted = toAokitError(
    new RegistryError("REGISTRY_UNTRUSTED", "untrusted", "pass --trust r", { registry: "r" }),
  );
  expect(untrusted instanceof AokitError && untrusted.code).toBe("REGISTRY_UNTRUSTED");
});

test("xdg helpers honor absolute XDG variables and fall back to HOME", () => {
  expect(xdgConfigDir({ XDG_CONFIG_HOME: "/x/config", HOME: "/home/u" })).toBe("/x/config/aokit");
  expect(xdgCacheDir({ XDG_CACHE_HOME: "/x/cache", HOME: "/home/u" })).toBe("/x/cache/aokit");
  expect(xdgConfigDir({ HOME: "/home/u" })).toBe("/home/u/.config/aokit");
  expect(xdgCacheDir({ HOME: "/home/u" })).toBe("/home/u/.cache/aokit");
  expect(xdgConfigDir({ XDG_CONFIG_HOME: "relative", HOME: "/home/u" })).toBe(
    "/home/u/.config/aokit",
  );
  expect(xdgCacheDir({ XDG_CACHE_HOME: "", HOME: "/home/u" })).toBe("/home/u/.cache/aokit");
});
