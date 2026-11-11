import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadProjectRegistriesOptions } from "../../src/project/registry.ts";
import { keepingIndexDocuments, pinnedToLockfile } from "../../src/project/registry/kept-index.ts";
import { openSource } from "../../src/project/registry/open-source.ts";
import { createRegistryCache } from "../../src/registry/cache.ts";
import { type Registry, RegistryError } from "../../src/registry/index.ts";
import {
  builtFixtureRegistry,
  removeTemporaryDirectories,
  serveRegistry,
  type ServedRegistry,
} from "../registry-remote/served-registry.ts";

const cliVersion = "99.0.0";
const commit = "0123456789abcdef0123456789abcdef01234567";

let scratch = "";
let builtRoot = "";
let served: ServedRegistry;
let githubHost: ServedRegistry;
let emptyHost: ServedRegistry;
let reachable = true;

const flakyFetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    reachable ? fetch(input, init) : Promise.reject(new TypeError("network unreachable")),
  { preconnect: fetch.preconnect },
);

function optionsFor(name: string, rawBaseUrl?: string): LoadProjectRegistriesOptions {
  return {
    trustFlags: [],
    interactive: false,
    projectDir: scratch,
    cliVersion,
    adapters: {
      cache: createRegistryCache({ dir: join(scratch, name, "modules") }),
      env: { XDG_CACHE_HOME: join(scratch, name, "cache"), XDG_CONFIG_HOME: join(scratch, "cfg") },
      fetch: flakyFetch,
      github: {
        lsRemote: () => Promise.resolve(`${commit}\trefs/heads/main\n`),
        ...(rawBaseUrl === undefined ? {} : { rawBaseUrl }),
      },
    },
  };
}

function cacheOf(options: LoadProjectRegistriesOptions): ReturnType<typeof createRegistryCache> {
  const cache = options.adapters?.cache;
  if (cache === undefined) throw new Error("the options carry no cache");
  return cache;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "aokit-kept-index-"));
  builtRoot = await builtFixtureRegistry();
  served = serveRegistry(builtRoot);
  const githubRoot = join(scratch, "github-root");
  await mkdir(join(githubRoot, "acme", "ui"), { recursive: true });
  await cp(builtRoot, join(githubRoot, "acme", "ui", commit), { recursive: true });
  githubHost = serveRegistry(githubRoot);
  const emptyRoot = join(scratch, "empty-root");
  await mkdir(emptyRoot, { recursive: true });
  emptyHost = serveRegistry(emptyRoot);
});

afterAll(async () => {
  await Promise.all([served.stop(), githubHost.stop(), emptyHost.stop()]);
  await removeTemporaryDirectories();
  await rm(scratch, { recursive: true, force: true });
});

async function onlineRegistry(): Promise<Registry> {
  reachable = true;
  const options = optionsFor("pinned");
  return openSource({ kind: "url", url: served.url }, options, cacheOf(options));
}

describe("keepingIndexDocuments", () => {
  const indexUrl = "https://registry.test/r/index.json";
  test("an unreachable index is served from its last kept copy and reported", async () => {
    const urls: string[] = [];
    const directory = await mkdtemp(join(tmpdir(), "aokit-kept-documents-"));
    let online = true;
    const upstream = Object.assign(
      (): Promise<Response> =>
        online
          ? Promise.resolve(new Response('{"kept":true}', { status: 200 }))
          : Promise.reject(new TypeError("offline")),
      { preconnect: fetch.preconnect },
    );
    const wrapped = keepingIndexDocuments(upstream, directory, (url) => urls.push(url));
    expect(await (await wrapped(indexUrl)).text()).toBe('{"kept":true}');
    expect(urls).toEqual([]);
    online = false;
    const offline = await wrapped(new URL(indexUrl));
    expect(offline.status).toBe(200);
    expect(await offline.text()).toBe('{"kept":true}');
    expect(urls).toEqual([indexUrl]);
    await rm(directory, { recursive: true, force: true });
  });

  test("an unreachable index with no kept copy fails as the network did", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aokit-kept-documents-"));
    const failure = new TypeError("offline");
    const wrapped = keepingIndexDocuments(
      Object.assign(() => Promise.reject(failure), { preconnect: fetch.preconnect }),
      directory,
      () => undefined,
    );
    expect(await rejection(wrapped(new Request(indexUrl)))).toBe(failure);
    await rm(directory, { recursive: true, force: true });
  });

  test("a kept copy that cannot be read fails as it is, not as missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aokit-kept-documents-"));
    const digest = new Bun.CryptoHasher("sha256").update(indexUrl).digest("hex");
    await mkdir(join(directory, `${digest}.json`), { recursive: true });
    const wrapped = keepingIndexDocuments(
      Object.assign(() => Promise.reject(new TypeError("offline")), {
        preconnect: fetch.preconnect,
      }),
      directory,
      () => undefined,
    );
    const failure = await rejection(wrapped(indexUrl));
    expect(failure).toMatchObject({ code: "EISDIR" });
    await rm(directory, { recursive: true, force: true });
  });

  test("an HTTP error is never replaced and other documents pass through", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aokit-kept-documents-"));
    const seen: string[] = [];
    const wrapped = keepingIndexDocuments(
      Object.assign(
        (): Promise<Response> => {
          seen.push("read");
          return Promise.resolve(new Response("down", { status: 503 }));
        },
        { preconnect: fetch.preconnect },
      ),
      directory,
      () => undefined,
    );
    expect((await wrapped(indexUrl)).status).toBe(503);
    expect((await wrapped("https://registry.test/r/modules/oxc.tgz")).status).toBe(503);
    expect(seen).toHaveLength(2);
    await rm(directory, { recursive: true, force: true });
  });
});

describe("pinnedToLockfile", () => {
  test("a Module version the Lockfile does not pin is refused offline", async () => {
    const registry = await onlineRegistry();
    const guarded = pinnedToLockfile(registry, new Map(), undefined);
    const name = Object.keys(registry.index.modules)[0] ?? "";
    const failure = await rejection(guarded.version(name, "1.0.0"));
    expect(failure).toBeInstanceOf(RegistryError);
    expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_FETCH_FAILED");
    expect(failure instanceof RegistryError && failure.message).toContain("does not pin");
  });

  test("a Module version whose listed integrity differs from the pinned one is refused", async () => {
    const registry = await onlineRegistry();
    const name = Object.keys(registry.index.modules)[0] ?? "";
    const version = registry.versions(name)[0] ?? "";
    const guarded = pinnedToLockfile(registry, new Map([[`${name}@${version}`, "sha256-x"]]), "r");
    const failure = await rejection(guarded.version(name, version));
    expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  });

  test("a Module version the index lists with the pinned integrity is served", async () => {
    const registry = await onlineRegistry();
    const name = Object.keys(registry.index.modules)[0] ?? "";
    const version = registry.versions(name)[0] ?? "";
    const { integrity } = await registry.version(name, version);
    const guarded = pinnedToLockfile(registry, new Map([[`${name}@${version}`, integrity]]), "r");
    expect((await guarded.version(name, version)).integrity).toBe(integrity);
  });

  test("a Catalog of a Release the Lockfile does not record is refused", async () => {
    const registry = await onlineRegistry();
    const guarded = pinnedToLockfile(registry, new Map(), "0.0.1");
    const failure = await rejection(guarded.catalog("9.9.9"));
    expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  });
});

describe("an unreachable Registry", () => {
  test("an https Registry reads its kept index and serves only pinned versions", async () => {
    const options = optionsFor("https");
    const cache = cacheOf(options);
    reachable = true;
    const online = await openSource({ kind: "url", url: served.url }, options, cache);
    reachable = false;
    const offline = await openSource({ kind: "url", url: served.url }, options, cache, {
      lockedRelease: online.release,
    });
    reachable = true;
    expect(offline.index.modules).toEqual(online.index.modules);
    const name = Object.keys(online.index.modules)[0] ?? "";
    const failure = await rejection(offline.version(name, online.versions(name)[0] ?? ""));
    expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_FETCH_FAILED");
  });

  test("a github Registry reads its kept index the same way", async () => {
    const options = optionsFor("github", githubHost.url);
    const cache = cacheOf(options);
    const source = { kind: "github", owner: "acme", repo: "ui", ref: "main" } as const;
    reachable = true;
    const online = await openSource(source, options, cache);
    reachable = false;
    const offline = await openSource(source, options, cache, { lockedRelease: online.release });
    reachable = true;
    expect(offline.source).toEqual({ ...source, ref: commit });
    const failure = await rejection(offline.catalog("0.0.0-unlocked"));
    expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  });

  test("a github repository whose index.json fails to load is not read as shadcn", async () => {
    const options = optionsFor("github-failing", githubHost.url);
    githubHost.failPaths.add(`acme/ui/${commit}/index.json`);
    const failure = await rejection(
      openSource(
        { kind: "github", owner: "acme", repo: "ui", ref: "main" },
        options,
        cacheOf(options),
      ),
    );
    githubHost.failPaths.clear();
    expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_FETCH_FAILED");
  });

  test("a github repository without an index.json opens as shadcn items", async () => {
    const options = optionsFor("shadcn-fallback", emptyHost.url);
    const registry = await openSource(
      { kind: "github", owner: "acme", repo: "ui", ref: "main" },
      options,
      cacheOf(options),
      { indexOptional: true },
    );
    expect(registry.source).toEqual({ kind: "github", owner: "acme", repo: "ui", ref: commit });
    expect(Object.keys(registry.index.modules)).toEqual([]);
  });
});
