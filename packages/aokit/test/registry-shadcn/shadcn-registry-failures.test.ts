import { afterEach, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UserConfig } from "../../src/config/user-config.ts";
import {
  type CachedModuleVersion,
  computeModuleIntegrity,
  formatRegistrySource,
  openRegistry,
  parseRegistrySource,
  type Registry,
  type RegistryCache,
  RegistryError,
} from "../../src/registry/index.ts";
import { removeTemporaryDirectories } from "../registry-remote/served-registry.ts";
import {
  removeShadcnFixtures,
  type ServedShadcnRegistry,
  serveShadcnRegistry,
} from "./served-shadcn-registry.ts";

const sourceContext = { projectDir: "/work/app", bundledRegistryPath: "/unused" };
const noConfig: UserConfig = { trustedRegistries: [] };
const servers: { stop(): Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await removeShadcnFixtures();
  await removeTemporaryDirectories();
});

function memoryCache(): RegistryCache & { entries: Map<string, CachedModuleVersion> } {
  const entries = new Map<string, CachedModuleVersion>();
  return {
    entries,
    get: (integrity) => Promise.resolve(entries.get(integrity)),
    put: (integrity, content) => {
      entries.set(integrity, content);
      return Promise.resolve();
    },
  };
}

async function served(): Promise<ServedShadcnRegistry> {
  const registry = await serveShadcnRegistry();
  servers.push(registry);
  return registry;
}

async function captureError(action: () => Promise<unknown>): Promise<RegistryError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof RegistryError) return error;
    throw error;
  }
  throw new Error("expected a RegistryError");
}

async function openServed(
  url: string,
  options: {
    cache?: RegistryCache;
    pinned?: ReadonlyMap<string, string>;
    items?: readonly string[];
    userConfig?: UserConfig;
  } = {},
): Promise<Registry> {
  return openRegistry(parseRegistrySource(url, sourceContext), {
    cliVersion: "0.1.0",
    cache: options.cache ?? memoryCache(),
    ...(options.pinned === undefined ? {} : { pinned: options.pinned }),
    ...(options.items === undefined ? {} : { items: options.items }),
    ...(options.userConfig === undefined ? {} : { userConfig: options.userConfig }),
  });
}

test("a Namespace the user config no longer declares opens from the template the Lockfile recorded", async () => {
  const fixture = await served();
  const registry = await openServed(`@acme=${fixture.url}/{name}.json`, {
    userConfig: noConfig,
    items: ["button"],
  });
  expect(registry.name).toBe("@acme");
  expect(formatRegistrySource(registry.source)).toBe(`@acme=${fixture.url}/{name}.json`);
  const version = registry.versions("@acme/button")[0] ?? "";
  const button = await registry.version("@acme/button", version);
  expect(button.manifest.name).toBe("@acme/button");
  expect(fixture.received.every((received) => received.headers.authorization === undefined)).toBe(
    true,
  );
});

test("a Namespace the user config does not declare and nothing recorded fails with REGISTRY_NOT_FOUND", async () => {
  const error = await captureError(() => openServed("@acme", { userConfig: noConfig }));
  expect(error.code).toBe("REGISTRY_NOT_FOUND");
});

test("a registry.json that is not JSON fails with REGISTRY_INDEX_INVALID", async () => {
  const fixture = await served();
  await writeFile(join(fixture.root, "registry.json"), "{ not json", "utf8");
  const error = await captureError(() => openServed(`${fixture.url}/registry.json`));
  expect(error.code).toBe("REGISTRY_INDEX_INVALID");
  expect(error.message).toContain(`${fixture.url}/registry.json`);
});

test("a registry.json that breaks the schema fails with REGISTRY_INDEX_INVALID naming the field", async () => {
  const fixture = await served();
  await writeFile(
    join(fixture.root, "registry.json"),
    JSON.stringify({ name: "fixture", items: "button" }),
    "utf8",
  );
  const error = await captureError(() => openServed(`${fixture.url}/registry.json`));
  expect(error.code).toBe("REGISTRY_INDEX_INVALID");
  expect(error.message).toContain("items");
});

test("an unreachable Registry with nothing pinned opens empty instead of failing", async () => {
  const fixture = await served();
  const recorded = `${fixture.url}/registry.json`;
  await fixture.stop();
  const registry = await openServed(recorded);
  expect(registry.name).toBe("r-127-0-0-1");
  expect(registry.versions("@r-127-0-0-1/button")).toEqual([]);
});

test("a requested item whose JSON is not valid fails with REGISTRY_MANIFEST_INVALID", async () => {
  const fixture = await served();
  await writeFile(join(fixture.root, "button.json"), "{ not json", "utf8");
  const error = await captureError(() => openServed(fixture.url, { items: ["button"] }));
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
  expect(error.data.module).toBe("button");
});

test("a requested item that breaks the item schema fails with REGISTRY_MANIFEST_INVALID", async () => {
  const fixture = await served();
  await fixture.writeItem({ name: "button", type: "registry:ui", files: "none" });
  const error = await captureError(() => openServed(fixture.url, { items: ["button"] }));
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
  expect(error.message).toContain("is invalid");
});

test("a requested item that names itself differently fails with REGISTRY_SUMMARY_MISMATCH", async () => {
  const fixture = await served();
  await writeFile(
    join(fixture.root, "button.json"),
    JSON.stringify({ name: "switch", type: "registry:ui", files: [] }),
    "utf8",
  );
  const error = await captureError(() => openServed(fixture.url, { items: ["button"] }));
  expect(error.code).toBe("REGISTRY_SUMMARY_MISMATCH");
  expect(error.data.expected).toBe("button");
  expect(error.data.actual).toBe("switch");
});

test("an item that cannot be adapted fails with its error carrying the Registry name", async () => {
  const fixture = await served();
  await fixture.writeItem({ name: "mono", type: "registry:font", files: [] });
  const error = await captureError(() => openServed(fixture.url, { items: ["mono"] }));
  expect(error.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
  expect(error.data.registry).toBe("fixture");
});

test("an item that fails to read without being requested fails when it is asked for", async () => {
  const fixture = await served();
  await writeFile(join(fixture.root, "button.json"), "{ not json", "utf8");
  const registry = await openServed(fixture.url);
  expect(registry.versions("@fixture/use-toggle")).toHaveLength(1);
  const error = await captureError(() => registry.version("@fixture/button", "0.0.0"));
  expect(error.code).toBe("REGISTRY_MANIFEST_INVALID");
});

test("an Adapted Module ships no Migration script and says so", async () => {
  const fixture = await served();
  const registry = await openServed(fixture.url);
  const version = registry.versions("@fixture/button")[0] ?? "";
  const button = await registry.version("@fixture/button", version);
  const error = await captureError(() =>
    Promise.resolve().then(() => button.migrationScript("m.ts")),
  );
  expect(error.code).toBe("REGISTRY_FILE_MISSING");
  expect(error.data.path).toBe("m.ts");
  expect(error.data.module).toBe(`@fixture/button@${version}`);
});

test("a cached manifest that cannot be parsed is ignored as a miss", async () => {
  const fixture = await served();
  const cache = memoryCache();
  const first = await openServed(fixture.url, { cache });
  const version = first.versions("@fixture/button")[0] ?? "";
  const files = new Map([["files/shared-ui/ui/button.tsx", "export {};\n"]]);
  const garbled = computeModuleIntegrity("{ not a manifest", files);
  cache.entries.set(garbled, { manifest: "{ not a manifest", files });
  const reopened = await openServed(fixture.url, {
    cache,
    pinned: new Map([[`@fixture/button@${version}`, garbled]]),
  });
  const error = await captureError(() => reopened.version("@fixture/button", version));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
});

test("a Module the Registry does not serve fails with REGISTRY_MODULE_NOT_FOUND listing what it serves", async () => {
  const fixture = await served();
  const registry = await openServed(fixture.url);
  const served1 = registry.versions("@fixture/button")[0] ?? "";
  const unknown = await captureError(() => registry.version("@fixture/nothing", "1.0.0"));
  expect(unknown.code).toBe("REGISTRY_MODULE_NOT_FOUND");
  expect(unknown.fix).toContain("(none)");
  const wrongVersion = await captureError(() => registry.version("@fixture/button", "9.9.9"));
  expect(wrongVersion.code).toBe("REGISTRY_MODULE_NOT_FOUND");
  expect(wrongVersion.fix).toContain(served1);
  const foreign = await captureError(() => registry.version("@other/button", served1));
  expect(foreign.code).toBe("REGISTRY_MODULE_NOT_FOUND");
});

test("asking for the same Module version twice reads it once and returns the same Module", async () => {
  const fixture = await served();
  const registry = await openServed(fixture.url);
  const version = registry.versions("@fixture/button")[0] ?? "";
  const first = registry.version("@fixture/button", version);
  const second = registry.version("@fixture/button", version);
  expect(second).toBe(first);
  expect(await second).toBe(await first);
});

test("a failed Module version is not memoized, so a later ask can succeed", async () => {
  const fixture = await served();
  const cache = memoryCache();
  const first = await openServed(fixture.url, { cache });
  const version = first.versions("@fixture/button")[0] ?? "";
  const { integrity } = await first.version("@fixture/button", version);
  await fixture.writeItem({
    name: "button",
    type: "registry:ui",
    files: [{ path: "ui/button.tsx", type: "registry:ui", content: "export const changed = 1;\n" }],
  });
  const registry = await openServed(fixture.url, {
    cache: memoryCache(),
    pinned: new Map([[`@fixture/button@${version}`, integrity]]),
  });
  const failed = await captureError(() => registry.version("@fixture/button", version));
  expect(failed.code).toBe("REGISTRY_ITEM_CHANGED");
  const again = await captureError(() => registry.version("@fixture/button", version));
  expect(again.code).toBe("REGISTRY_ITEM_CHANGED");
});

test("a registry.json that answers with an HTTP error is not mistaken for an offline Registry", async () => {
  const failingFetch: typeof fetch = Object.assign(
    (): Promise<Response> => Promise.resolve(new Response("upstream down", { status: 500 })),
    { preconnect: () => undefined },
  );
  const error = await captureError(() =>
    openRegistry(parseRegistrySource("https://fixture.invalid/registry.json", sourceContext), {
      cliVersion: "0.1.0",
      cache: memoryCache(),
      fetch: failingFetch,
    }),
  );
  expect(error.code).toBe("REGISTRY_FETCH_FAILED");
  expect(error.data.status).toBe(500);
});

test("a cache that fails to read is treated as a miss", async () => {
  const fixture = await served();
  const first = await openServed(fixture.url);
  const version = first.versions("@fixture/button")[0] ?? "";
  const { integrity } = await first.version("@fixture/button", version);
  await fixture.writeItem({
    name: "button",
    type: "registry:ui",
    files: [{ path: "ui/button.tsx", type: "registry:ui", content: "export const changed = 1;\n" }],
  });
  const brokenCache: RegistryCache = {
    get: () => Promise.reject(new Error("cache unreadable")),
    put: () => Promise.resolve(),
  };
  const reopened = await openServed(fixture.url, {
    cache: brokenCache,
    pinned: new Map([[`@fixture/button@${version}`, integrity]]),
  });
  const error = await captureError(() => reopened.version("@fixture/button", version));
  expect(error.code).toBe("REGISTRY_ITEM_CHANGED");
});

test("a cached manifest of another version is ignored as a miss", async () => {
  const fixture = await served();
  const cache = memoryCache();
  const first = await openServed(fixture.url, { cache });
  const version = first.versions("@fixture/button")[0] ?? "";
  const { integrity } = await first.version("@fixture/button", version);
  const otherVersion = "0.0.0-shadcn.000000000000";
  const reopened = await openServed(fixture.url, {
    cache,
    pinned: new Map([[`@fixture/button@${otherVersion}`, integrity]]),
  });
  const error = await captureError(() => reopened.version("@fixture/button", otherVersion));
  expect(error.code).toBe("REGISTRY_ITEM_CHANGED");
});
