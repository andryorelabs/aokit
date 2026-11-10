import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  allInOrder,
  byCodepoint,
  type CachedModuleVersion,
  parseJson,
  type RegistryCache,
  verifyIntegrity,
} from "../../src/registry/client/common.ts";
import {
  checkCliVersion,
  parseIndex,
  readCatalog,
  transportFor,
} from "../../src/registry/client/index-file.ts";
import {
  loadModuleVersion,
  parseModuleManifest,
} from "../../src/registry/client/module-version.ts";
import { openRegistry } from "../../src/registry/client/open.ts";
import { openShadcnRegistry } from "../../src/registry/client/shadcn.ts";
import {
  asIntegrity,
  hostScope,
  scopeOf,
  splitModuleKey,
} from "../../src/registry/client/shadcn-items.ts";
import { computeIntegrity, RegistryError } from "../../src/registry/index.ts";
import { fixtureItems } from "../registry-shadcn/served-shadcn-registry.ts";

const builtRegistry = resolve(import.meta.dir, "../../../../registry");
const cliVersion = "99.0.0";

function memoryCache(): RegistryCache {
  const entries = new Map<string, CachedModuleVersion>();
  return {
    get: (integrity) => Promise.resolve(entries.get(integrity)),
    put: (integrity, content) => {
      entries.set(integrity, content);
      return Promise.resolve();
    },
  };
}

function servingFiles(files: Readonly<Record<string, string>>): typeof fetch {
  const serve = (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = files[new URL(url).pathname];
    return Promise.resolve(
      body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 }),
    );
  };
  return Object.assign(serve, { preconnect: fetch.preconnect });
}

function indexInvalid(reason: string): RegistryError {
  return new RegistryError("REGISTRY_INDEX_INVALID", reason, "fix", { registry: "r" });
}

async function caughtCode(run: () => unknown): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof RegistryError ? error.code : "not a RegistryError";
  }
  return undefined;
}

describe("common", () => {
  test("allInOrder rethrows the earliest rejection in input order", async () => {
    const late = new Promise<number>((_, reject) => {
      setTimeout(() => reject(new Error("first")), 5);
    });
    const failure = await allInOrder([late, Promise.reject(new Error("second"))]).catch(
      (error: unknown) => error,
    );
    expect(String(failure)).toBe("Error: first");
  });

  test("byCodepoint sorts by code point, not locale", () => {
    expect(["b", "B", "a"].toSorted(byCodepoint)).toEqual(["B", "a", "b"]);
  });

  test("parseJson reports invalid JSON through its callback", () => {
    expect(() => parseJson("{", indexInvalid)).toThrow(RegistryError);
  });

  test("verifyIntegrity refuses a mismatch", async () => {
    const code = await caughtCode(() =>
      verifyIntegrity(computeIntegrity("a"), computeIntegrity("b"), "subject", { registry: "r" }),
    );
    expect(code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  });
});

describe("index file", () => {
  test("a missing index is REGISTRY_NOT_FOUND", async () => {
    const { transport } = await transportFor({ kind: "local", path: "/nowhere" }, { cliVersion });
    expect(await caughtCode(() => parseIndex(transport, undefined))).toBe("REGISTRY_NOT_FOUND");
  });

  test("an index needing a newer CLI is refused", async () => {
    const { transport } = await transportFor(
      { kind: "local", path: builtRegistry },
      { cliVersion },
    );
    const index = parseIndex(transport, await transport.read("index.json"));
    expect(await caughtCode(() => checkCliVersion(index, "0.0.1"))).toBe("REGISTRY_CLI_TOO_OLD");
    const pointer = index.releases[index.release];
    if (pointer === undefined) throw new Error("the built Registry has no current Catalog");
    const catalog = await readCatalog(transport, index.name, index.release, pointer);
    expect(catalog.release).toBe(index.release);
  });
});

describe("module version", () => {
  test("a manifest that is not JSON is REGISTRY_MANIFEST_INVALID", async () => {
    expect(await caughtCode(() => parseModuleManifest("{", "Module x", "r"))).toBe(
      "REGISTRY_MANIFEST_INVALID",
    );
  });

  test("a published version loads, verified, and is cached", async () => {
    const { transport } = await transportFor(
      { kind: "local", path: builtRegistry },
      { cliVersion },
    );
    const index = parseIndex(transport, await transport.read("index.json"));
    const version = index.modules.oxc?.latest ?? "";
    const entry = index.modules.oxc?.versions[version];
    if (entry === undefined) throw new Error("the built Registry does not publish oxc");
    const cache = memoryCache();
    const loaded = await loadModuleVersion(transport, cache, index, "oxc", version, entry);
    expect(loaded.integrity).toBe(entry.integrity);
    expect(await cache.get(entry.integrity)).toBeDefined();
  });
});

describe("shadcn items", () => {
  test("helpers split keys, scope hosts and check integrities", () => {
    expect(splitModuleKey("@acme/button@0.0.0-shadcn.abc")).toEqual({
      name: "@acme/button",
      version: "0.0.0-shadcn.abc",
    });
    expect(splitModuleKey("@acme")).toBeUndefined();
    expect(hostScope("https://1.example.com/r")).toBe("r-1-example-com");
    expect(scopeOf("@acme/button")).toBe("acme");
    expect(asIntegrity("sha256-short")).toBeUndefined();
  });
});

describe("shadcn registry", () => {
  test("a registry.json and its items open as Adapted Modules", async () => {
    const items = fixtureItems();
    const files: Record<string, string> = {
      "/r/registry.json": JSON.stringify({ name: "fixture", items }),
    };
    for (const item of items) files[`/r/${item.name}.json`] = JSON.stringify(item);
    const registry = await openShadcnRegistry(
      { kind: "shadcn", url: "https://shadcn.test/r" },
      { cliVersion, cache: memoryCache(), fetch: servingFiles(files) },
    );
    expect(registry.name).toBe("fixture");
    expect(registry.selectableVersions("@fixture/button")).toHaveLength(1);
  });

  test("a host serving no registry.json is REGISTRY_NOT_FOUND", async () => {
    const code = await caughtCode(() =>
      openShadcnRegistry(
        { kind: "shadcn", url: "https://shadcn.test/r" },
        { cliVersion, cache: memoryCache(), fetch: servingFiles({}) },
      ),
    );
    expect(code).toBe("REGISTRY_NOT_FOUND");
  });
});

describe("open", () => {
  test("a local Registry opens behind the lazy interface", async () => {
    const registry = await openRegistry({ kind: "local", path: builtRegistry }, { cliVersion });
    expect(registry.name).toBe("official");
    expect(await registry.catalog("no-such-release")).toBeUndefined();
    expect(await caughtCode(() => registry.version("oxc", "0.0.0-none"))).toBe(
      "REGISTRY_MODULE_NOT_FOUND",
    );
  });
});
