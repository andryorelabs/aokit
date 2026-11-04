import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistryCache } from "../../src/registry/cache.ts";
import { openRegistry, parseRegistrySource, RegistryError } from "../../src/registry/index.ts";
import {
  builtFixtureRegistry,
  removeTemporaryDirectories,
  type ServedRegistry,
  serveRegistry,
} from "../registry-remote/served-registry.ts";

const context = { cliVersion: "0.1.0" };
const sourceContext = { projectDir: "/work/app", bundledRegistryPath: "/bundled" };
const integrity = `sha256-${"a".repeat(64)}` as const;
const servers: ServedRegistry[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  await removeTemporaryDirectories();
});

async function cacheDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aokit-registry-cache-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function rejection(promise: Promise<unknown>): Promise<RegistryError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RegistryError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a RegistryError");
}

async function servedFixture(): Promise<ServedRegistry> {
  const server = serveRegistry(await builtFixtureRegistry());
  servers.push(server);
  return server;
}

test("a put entry is read back with its manifest and every file, nested paths included", async () => {
  const cache = createRegistryCache({ dir: await cacheDirectory() });
  const files = new Map([
    ["files/a.txt", "a\n"],
    ["files/nested/b.md", "# b\n"],
  ]);
  expect(await cache.get(integrity)).toBeUndefined();
  await cache.put(integrity, { manifest: '{"name":"m"}\n', files });
  const entry = await cache.get(integrity);
  expect(entry?.manifest).toBe('{"name":"m"}\n');
  expect(Object.fromEntries(entry?.files ?? [])).toEqual({
    "files/a.txt": "a\n",
    "files/nested/b.md": "# b\n",
  });
});

test("put overwrites whatever the entry held, dropping files it no longer has", async () => {
  const cache = createRegistryCache({ dir: await cacheDirectory() });
  await cache.put(integrity, { manifest: "old\n", files: new Map([["files/stale.txt", "x\n"]]) });
  await cache.put(integrity, { manifest: "new\n", files: new Map([["files/fresh.txt", "y\n"]]) });
  const entry = await cache.get(integrity);
  expect(entry?.manifest).toBe("new\n");
  expect(entry === undefined ? [] : [...entry.files.keys()]).toEqual(["files/fresh.txt"]);
});

test("entries live under <dir>/<integrity>/ and the default dir is $XDG_CACHE_HOME/aokit/registry", async () => {
  const xdg = await cacheDirectory();
  const previous = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = xdg;
  try {
    await createRegistryCache().put(integrity, { manifest: "m\n", files: new Map() });
  } finally {
    if (previous === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = previous;
    }
  }
  expect(await readdir(join(xdg, "aokit", "registry"))).toEqual([integrity]);
});

test("a key that is not an integrity or a file path that escapes the entry is refused", async () => {
  const dir = await cacheDirectory();
  const cache = createRegistryCache({ dir });
  const badKey = await rejection(cache.get("sha256-../../etc"));
  expect(badKey.code).toBe("REGISTRY_PATH_UNSAFE");
  const escaping = await rejection(
    cache.put(integrity, { manifest: "m\n", files: new Map([["../escape.txt", "x\n"]]) }),
  );
  expect(escaping.code).toBe("REGISTRY_PATH_UNSAFE");
  expect(await readdir(dir)).toEqual([]);
});

test("a Module fetched once is read from the cache after the server stops", async () => {
  const server = await servedFixture();
  const cache = createRegistryCache({ dir: await cacheDirectory() });
  const source = parseRegistrySource(server.url, sourceContext);
  const fetched = await (await openRegistry(source, { ...context, cache })).version("oxc", "1.0.0");
  const reopened = await openRegistry(source, { ...context, cache });
  await server.stop();
  const cached = await reopened.version("oxc", "1.0.0");
  expect([...cached.files]).toEqual([...fetched.files]);
  expect(cached.integrity).toBe(fetched.integrity);
});

test("a cached file altered on disk is never used: it is refetched, verified and rewritten", async () => {
  const server = await servedFixture();
  const dir = await cacheDirectory();
  const cache = createRegistryCache({ dir });
  const source = parseRegistrySource(server.url, sourceContext);
  const first = await openRegistry(source, { ...context, cache });
  const genuine = await first.version("oxc", "1.0.0");
  const cachedNotes = join(dir, genuine.integrity, "files", "files", "nested", "notes.md");
  expect(await readFile(cachedNotes, "utf8")).toBe("# {{name}}\n");
  await writeFile(cachedNotes, "# tampered\n");
  const reopened = await openRegistry(source, { ...context, cache });
  const requestsBefore = server.requests.length;
  const read = await reopened.version("oxc", "1.0.0");
  expect(read.files.get("files/nested/notes.md")).toBe("# {{name}}\n");
  expect(server.requests.length).toBeGreaterThan(requestsBefore);
  expect(await readFile(cachedNotes, "utf8")).toBe("# {{name}}\n");
});

test("a cached manifest altered on disk fails the hit and the refetch passes integrity", async () => {
  const server = await servedFixture();
  const dir = await cacheDirectory();
  const cache = createRegistryCache({ dir });
  const source = parseRegistrySource(server.url, sourceContext);
  const genuine = await (await openRegistry(source, { ...context, cache })).version("oxc", "1.0.0");
  await writeFile(join(dir, genuine.integrity, "manifest.json"), "{}\n");
  const read = await (await openRegistry(source, { ...context, cache })).version("oxc", "1.0.0");
  expect(read.integrity).toBe(genuine.integrity);
  expect(read.manifest).toEqual(genuine.manifest);
});

test("a local Registry never reads or writes the cache", async () => {
  const dir = await cacheDirectory();
  const cache = createRegistryCache({ dir });
  const registry = await openRegistry(
    { kind: "local", path: await builtFixtureRegistry() },
    { ...context, cache },
  );
  await registry.version("oxc", "1.0.0");
  expect(await readdir(dir)).toEqual([]);
});
