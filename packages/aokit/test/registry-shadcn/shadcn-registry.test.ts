import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorCodeExitCodes } from "../../src/cli/exit-codes.ts";
import type { UserConfig } from "../../src/config/user-config.ts";
import { openProjectRegistries } from "../../src/project/registry.ts";
import { createRegistryCache } from "../../src/registry/cache.ts";
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
import { ensureTrusted } from "../../src/trust/gate.ts";
import { sourceIdentity, sourceStringIdentity } from "../../src/trust/identity.ts";
import {
  builtFixtureRegistry,
  removeTemporaryDirectories,
  serveRegistry,
} from "../registry-remote/served-registry.ts";
import {
  fixtureItems,
  removeShadcnFixtures,
  type ServedShadcnRegistry,
  serveShadcnRegistry,
} from "./served-shadcn-registry.ts";

const sourceContext = { projectDir: "/work/app", bundledRegistryPath: "/unused" };
const noConfig: UserConfig = { trustedRegistries: [] };
const servers: { stop(): Promise<void> }[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  await removeShadcnFixtures();
  await removeTemporaryDirectories();
});

function memoryCache(): RegistryCache & { entries: Map<string, CachedModuleVersion> } {
  const entries = new Map<string, CachedModuleVersion>();
  return {
    entries,
    get: async (integrity) => entries.get(integrity),
    put: async (integrity, content) => {
      entries.set(integrity, content);
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
  options: { cache?: RegistryCache; pinned?: ReadonlyMap<string, string> } = {},
): Promise<Registry> {
  return openRegistry(parseRegistrySource(url, sourceContext), {
    cliVersion: "0.1.0",
    cache: options.cache ?? memoryCache(),
    ...(options.pinned === undefined ? {} : { pinned: options.pinned }),
  });
}

function changedButton(): Record<string, unknown> & { name: string } {
  const [button] = fixtureItems();
  return {
    ...button,
    name: "button",
    files: [{ path: "ui/button.tsx", type: "registry:ui", content: "export const changed = 1;\n" }],
  };
}

test("a URL serving registry.json opens as a shadcn Registry and never reads the aokit index path", async () => {
  const fixture = await served();
  const registry = await openServed(fixture.url);
  expect(registry.source).toEqual({ kind: "shadcn", url: fixture.url });
  expect(registry.name).toBe("fixture");
  expect(formatRegistrySource(registry.source)).toBe(`${fixture.url}/registry.json`);
  expect(fixture.requests.some((path) => path.startsWith("catalog/"))).toBe(false);
  expect(fixture.requests.some((path) => path.startsWith("modules/"))).toBe(false);
  expect(fixture.requests).toContain("registry.json");

  fixture.requests.length = 0;
  await openServed(`${fixture.url}/registry.json`);
  expect(fixture.requests).not.toContain("index.json");
});

test("a URL serving index.json opens as an aokit Registry and never reads registry.json", async () => {
  const server = serveRegistry(await builtFixtureRegistry());
  servers.push(server);
  const registry = await openServed(server.url);
  expect(registry.source.kind).toBe("url");
  expect(server.requests).not.toContain("registry.json");
});

test("a URL serving neither index fails with REGISTRY_NOT_FOUND", async () => {
  const empty = await mkdtemp(join(tmpdir(), "aokit-shadcn-empty-"));
  directories.push(empty);
  const server = serveRegistry(empty);
  servers.push(server);
  const error = await captureError(() => openServed(server.url));
  expect(error.code).toBe("REGISTRY_NOT_FOUND");
});

test("shadcn items are served as Adapted Modules with a synthetic version and their integrity", async () => {
  const fixture = await served();
  const cache = memoryCache();
  const registry = await openServed(fixture.url, { cache });
  const [version] = registry.versions("@fixture/button");
  expect(version).toMatch(/^0\.0\.0-shadcn\.[0-9a-f]{12}$/);
  expect(registry.selectableVersions("@fixture/button")).toEqual([version ?? ""]);
  const button = await registry.version("@fixture/button", version ?? "");
  expect(button.manifest.name).toBe("@fixture/button");
  expect(button.manifest.migrations).toEqual([]);
  expect(button.integrity).toBe(
    computeModuleIntegrity(
      cache.entries.get(button.integrity)?.manifest ?? "",
      cache.entries.get(button.integrity)?.files ?? new Map(),
    ),
  );
  expect(registry.index.modules["@fixture/button"]?.versions[version ?? ""]?.integrity).toBe(
    button.integrity,
  );
  expect(registry.currentCatalog.modules["@fixture/button"]).toBe(version);
  expect(registry.versions("@fixture/use-toggle")).toHaveLength(1);
});

test("every adapted item is stored in the integrity cache at open", async () => {
  const fixture = await served();
  const cache = memoryCache();
  const registry = await openServed(fixture.url, { cache });
  const integrities = ["@fixture/button", "@fixture/use-toggle"].map(
    (name) => registry.index.modules[name]?.versions[registry.versions(name)[0] ?? ""]?.integrity,
  );
  expect([...cache.entries.keys()].toSorted()).toEqual(
    integrities.map((integrity) => integrity ?? "").toSorted(),
  );
});

test("an unsupported item fails only when it is asked for", async () => {
  const fixture = await served();
  const registry = await openServed(fixture.url);
  expect(registry.versions("@fixture/mono")).toEqual([]);
  const lazy = await captureError(() =>
    registry.version("@fixture/mono", "0.0.0-shadcn.000000000000"),
  );
  expect(lazy.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
  expect(lazy.data.registry).toBe("fixture");

  const eager = await captureError(() =>
    openRegistry(parseRegistrySource(fixture.url, sourceContext), {
      cliVersion: "0.1.0",
      cache: memoryCache(),
      items: ["mono"],
    }),
  );
  expect(eager.code).toBe("REGISTRY_ITEM_UNSUPPORTED");
  expect(eager.data.module).toBe("mono");
});

test("a pinned item is read offline from a warm cache", async () => {
  const fixture = await served();
  const cacheDir = await mkdtemp(join(tmpdir(), "aokit-shadcn-cache-"));
  directories.push(cacheDir);
  const cache = createRegistryCache({ dir: cacheDir });
  const online = await openServed(fixture.url, { cache });
  const version = online.versions("@fixture/button")[0] ?? "";
  const { integrity } = await online.version("@fixture/button", version);
  const recorded = formatRegistrySource(online.source);
  await fixture.stop();

  const offline = await openServed(recorded, {
    cache: createRegistryCache({ dir: cacheDir }),
    pinned: new Map([[`@fixture/button@${version}`, integrity]]),
  });
  expect(offline.name).toBe("fixture");
  expect(offline.versions("@fixture/button")).toEqual([version]);
  const button = await offline.version("@fixture/button", version);
  expect(button.integrity).toBe(integrity);
  expect(button.manifest.name).toBe("@fixture/button");
});

test("an item changed upstream with an empty cache fails with REGISTRY_ITEM_CHANGED", async () => {
  const fixture = await served();
  const first = await openServed(fixture.url);
  const version = first.versions("@fixture/button")[0] ?? "";
  const { integrity } = await first.version("@fixture/button", version);
  await fixture.writeItem(changedButton());

  const registry = await openServed(fixture.url, {
    pinned: new Map([[`@fixture/button@${version}`, integrity]]),
  });
  expect(registry.versions("@fixture/button")).toContain(version);
  expect(registry.selectableVersions("@fixture/button")).not.toContain(version);
  const error = await captureError(() => registry.version("@fixture/button", version));
  expect(error.code).toBe("REGISTRY_ITEM_CHANGED");
  expect(error.data).toMatchObject({
    registry: "fixture",
    module: `@fixture/button@${version}`,
    expected: integrity,
  });
  expect(error.fix).toContain("aokit update");
  expect(errorCodeExitCodes.REGISTRY_ITEM_CHANGED).toBe(1);
});

test("an item changed upstream is still served from a warm cache", async () => {
  const fixture = await served();
  const cache = memoryCache();
  const first = await openServed(fixture.url, { cache });
  const version = first.versions("@fixture/button")[0] ?? "";
  const { integrity } = await first.version("@fixture/button", version);
  await fixture.writeItem(changedButton());

  const registry = await openServed(fixture.url, {
    cache,
    pinned: new Map([[`@fixture/button@${version}`, integrity]]),
  });
  expect((await registry.version("@fixture/button", version)).integrity).toBe(integrity);
  const newest = registry.selectableVersions("@fixture/button").at(-1) ?? "";
  expect(newest).not.toBe(version);
  expect((await registry.version("@fixture/button", newest)).integrity).not.toBe(integrity);
});

test("a corrupted cache hit is ignored and the changed item fails with REGISTRY_ITEM_CHANGED", async () => {
  const fixture = await served();
  const cache = memoryCache();
  const first = await openServed(fixture.url, { cache });
  const version = first.versions("@fixture/button")[0] ?? "";
  const { integrity } = await first.version("@fixture/button", version);
  const entry = cache.entries.get(integrity);
  cache.entries.set(integrity, {
    manifest: entry?.manifest ?? "",
    files: new Map([...(entry?.files ?? [])].map(([path]) => [path, "tampered\n"])),
  });
  await fixture.writeItem(changedButton());
  const registry = await openServed(fixture.url, {
    cache,
    pinned: new Map([[`@fixture/button@${version}`, integrity]]),
  });
  const error = await captureError(() => registry.version("@fixture/button", version));
  expect(error.code).toBe("REGISTRY_ITEM_CHANGED");
});

test("a served item whose integrity differs from the recorded one is REGISTRY_INTEGRITY_MISMATCH", async () => {
  const fixture = await served();
  const first = await openServed(fixture.url);
  const version = first.versions("@fixture/button")[0] ?? "";
  const recorded = `sha256-${"0".repeat(64)}`;
  const registry = await openServed(fixture.url, {
    pinned: new Map([[`@fixture/button@${version}`, recorded]]),
  });
  const error = await captureError(() => registry.version("@fixture/button", version));
  expect(error.code).toBe("REGISTRY_INTEGRITY_MISMATCH");
  expect(error.data).toMatchObject({ registry: "fixture", expected: recorded });
});

test("a non-interactive run on an untrusted shadcn Registry fails with the exact --trust form", async () => {
  const fixture = await served();
  const options = {
    trustFlags: [],
    interactive: false,
    cliVersion: "0.1.0",
    projectDir: "/work/app",
    adapters: { cache: memoryCache(), userConfig: noConfig, env: {} },
  };
  const error = await captureError(() =>
    openProjectRegistries(undefined, { ...options, registryFlag: fixture.url }),
  );
  expect(error.code).toBe("REGISTRY_UNTRUSTED");
  expect(error.message).toContain("Rerun with `--trust fixture`");

  const trusted = await openProjectRegistries(undefined, {
    ...options,
    registryFlag: fixture.url,
    trustFlags: [fixture.url],
  });
  expect(trusted.entries.fixture?.source).toBe(`${fixture.url}/registry.json`);
  expect(trusted.decisions[0]?.via).toBe("flag");
});

test("an item JSON claiming trust does not change trust", async () => {
  const [button, ...rest] = fixtureItems();
  const registryServer = await serveShadcnRegistry([
    { ...button, name: "button", trusted: true, registry: { trusted: true } },
    ...rest,
  ]);
  servers.push(registryServer);
  const registry = await openServed(registryServer.url);
  const error = await captureError(() =>
    ensureTrusted([registry], { trustFlags: [], interactive: false, userConfig: noConfig }),
  );
  expect(error.code).toBe("REGISTRY_UNTRUSTED");
});

async function servedNamespace(): Promise<{
  fixture: ServedShadcnRegistry;
  userConfig: UserConfig;
}> {
  const fixture = await served();
  return {
    fixture,
    userConfig: {
      trustedRegistries: [],
      registries: {
        "@acme": {
          url: `${fixture.url}/{name}.json`,
          headers: { Authorization: "Bearer ${ACME_TOKEN}" },
        },
      },
    },
  };
}

test("a Namespace opens through the user config with its headers and records its template", async () => {
  const { fixture, userConfig } = await servedNamespace();
  const registry = await openRegistry(parseRegistrySource("@acme", sourceContext), {
    cliVersion: "0.1.0",
    cache: memoryCache(),
    userConfig,
    env: { ACME_TOKEN: "secret-token-value" },
    items: ["button"],
  });
  expect(registry.name).toBe("@acme");
  expect(formatRegistrySource(registry.source)).toBe(`@acme=${fixture.url}/{name}.json`);
  const version = registry.versions("@acme/button")[0] ?? "";
  const button = await registry.version("@acme/button", version);
  expect(button.manifest.name).toBe("@acme/button");
  const request = fixture.received.find((received) => received.path === "button.json");
  expect(request?.headers.authorization).toBe("Bearer secret-token-value");
  expect(fixture.requests).not.toContain("registry.json");
  expect(JSON.stringify(registry.source)).not.toContain("secret-token-value");
});

test("a Namespace item whose variable is unset fails with REGISTRY_ENV_UNSET", async () => {
  const { userConfig } = await servedNamespace();
  const error = await captureError(() =>
    openRegistry(parseRegistrySource("@acme", sourceContext), {
      cliVersion: "0.1.0",
      cache: memoryCache(),
      userConfig,
      env: {},
      items: ["button"],
    }),
  );
  expect(error.code).toBe("REGISTRY_ENV_UNSET");
  expect(error.data.variable).toBe("ACME_TOKEN");
});

test("a Namespace name pointed at another host is not trusted by the Lockfile or a bare --trust", async () => {
  const { userConfig } = await servedNamespace();
  const registry = await openRegistry(parseRegistrySource("@acme", sourceContext), {
    cliVersion: "0.1.0",
    cache: memoryCache(),
    userConfig,
    env: { ACME_TOKEN: "secret-token-value" },
  });
  const lockfile = {
    registries: {
      "@acme": {
        source: "@acme=https://registry.acme.dev/r/{name}.json",
        release: "shadcn",
        minCliVersion: "0.0.0",
        trusted: true,
      },
    },
  };
  const options = { interactive: false, userConfig: noConfig, lockfile };
  const spoofed = await captureError(() =>
    ensureTrusted([registry], { ...options, trustFlags: [] }),
  );
  expect(spoofed.code).toBe("REGISTRY_UNTRUSTED");
  expect(spoofed.message).toContain(`--trust ${formatRegistrySource(registry.source)}`);
  const bare = await captureError(() =>
    ensureTrusted([registry], { ...options, trustFlags: ["@acme"] }),
  );
  expect(bare.code).toBe("REGISTRY_UNTRUSTED");

  const exactFlag = await ensureTrusted([registry], {
    ...options,
    trustFlags: [formatRegistrySource(registry.source)],
  });
  expect(exactFlag[0]?.via).toBe("flag");

  const sameHost = {
    registries: {
      "@acme": { ...lockfile.registries["@acme"], source: formatRegistrySource(registry.source) },
    },
  };
  const decisions = await ensureTrusted([registry], {
    ...options,
    lockfile: sameHost,
    trustFlags: [],
  });
  expect(decisions[0]?.via).toBe("lockfile");
});

test("a Namespace url with a variable in its query keeps the query and never shows the expanded value", async () => {
  const fixture = await served();
  const options = {
    cliVersion: "0.1.0",
    cache: memoryCache(),
    userConfig: {
      trustedRegistries: [],
      registries: { "@acme": { url: `${fixture.url}/{name}.json?key=\${ACME_KEY}` } },
    } satisfies UserConfig,
    env: { ACME_KEY: "supersecretvalue123" },
    items: ["button"],
  };
  const registry = await openRegistry(parseRegistrySource("@acme", sourceContext), options);
  const version = registry.versions("@acme/button")[0] ?? "";
  expect((await registry.version("@acme/button", version)).manifest.name).toBe("@acme/button");
  expect(formatRegistrySource(registry.source)).toContain("${ACME_KEY}");

  const down = await captureError(() =>
    openRegistry(parseRegistrySource("@acme", sourceContext), {
      ...options,
      cache: memoryCache(),
      userConfig: {
        trustedRegistries: [],
        registries: { "@acme": { url: "http://127.0.0.1:1/{name}.json?key=${ACME_KEY}" } },
      },
    }),
  );
  expect(JSON.stringify([down.message, down.fix, down.data])).not.toContain("supersecretvalue123");
});

test("a path starting with @ is rejected with a hint to prefix it with ./", () => {
  const failure = (() => {
    try {
      parseRegistrySource("@company/registry", sourceContext);
    } catch (error) {
      return error;
    }
    return undefined;
  })();
  expect(failure).toBeInstanceOf(RegistryError);
  expect(failure instanceof RegistryError ? failure.fix : "").toContain("./@name");
});

test("shadcn sources parse back from their formatted form and bind trust to the host", () => {
  const url = parseRegistrySource("https://ui.example.dev/r/registry.json", sourceContext);
  expect(url).toEqual({ kind: "shadcn", url: "https://ui.example.dev/r" });
  expect(parseRegistrySource(formatRegistrySource(url), sourceContext)).toEqual(url);
  expect(sourceStringIdentity("https://ui.example.dev/r")).toBe(sourceIdentity(url));

  const namespace = parseRegistrySource("@acme=https://a.example/r/{name}.json", sourceContext);
  expect(namespace).toEqual({
    kind: "shadcn",
    namespace: "@acme",
    url: "https://a.example/r/{name}.json",
  });
  expect(parseRegistrySource(formatRegistrySource(namespace), sourceContext)).toEqual(namespace);
  expect(parseRegistrySource("@shadcn", sourceContext)).toEqual({
    kind: "shadcn",
    namespace: "@shadcn",
    url: "",
  });
  expect(sourceStringIdentity("@acme=https://a.example/r/{name}.json")).toBe(
    sourceIdentity(namespace),
  );
  expect(sourceStringIdentity("@acme=https://b.example/r/{name}.json")).not.toBe(
    sourceIdentity(namespace),
  );
  expect(sourceStringIdentity("@other=https://a.example/r/{name}.json")).not.toBe(
    sourceIdentity(namespace),
  );
  expect(sourceStringIdentity("@acme")).toBeUndefined();
  expect(() => parseRegistrySource("@acme=https://a.example/r/button.json", sourceContext)).toThrow(
    RegistryError,
  );
});
