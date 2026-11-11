import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import type { LoadProjectRegistriesOptions } from "../../src/project/registry.ts";
import { loadCreateRegistries } from "../../src/project/registry/create.ts";
import {
  itemDependencies,
  itemUrl,
  withRegistryDependencies,
} from "../../src/project/registry/dependencies.ts";
import { openProjectRegistries } from "../../src/project/registry/project-registries.ts";
import { openShadcnAddresses } from "../../src/project/registry/shadcn-addresses.ts";
import { createRegistryCache } from "../../src/registry/cache.ts";
import { RegistryError } from "../../src/registry/index.ts";
import {
  type FixtureItem,
  removeShadcnFixtures,
  type ServedShadcnRegistry,
  serveShadcnRegistry,
} from "../registry-shadcn/served-shadcn-registry.ts";

const builtRegistry = resolve(import.meta.dir, "../../../../registry");
const cliVersion = "99.0.0";

let scratch = "";
let fixture: ServedShadcnRegistry;
let rival: ServedShadcnRegistry;
let twin: ServedShadcnRegistry;
let options: LoadProjectRegistriesOptions;

function libraryItem(name: string, registryDependencies: string[] = []): FixtureItem {
  return {
    name,
    type: "registry:lib",
    registryDependencies,
    files: [
      {
        path: `lib/${name}.ts`,
        type: "registry:lib",
        content: `export const ${name.replaceAll("-", "")} = 1;\n`,
      },
    ],
  };
}

function entry(source: string): { source: string; release: string; minCliVersion: string } {
  return { source, release: "r", minCliVersion: "0.0.0" };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

async function openFixtureSet(): ReturnType<typeof openProjectRegistries> {
  return openProjectRegistries(undefined, {
    ...options,
    registryFlag: fixture.url,
    trustFlags: [fixture.url],
  });
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "aokit-shadcn-addresses-"));
  fixture = await serveShadcnRegistry(
    [libraryItem("plain"), libraryItem("local-user", ["./local.json"])],
    "fixture",
  );
  rival = await serveShadcnRegistry([libraryItem("plain")], "official");
  twin = await serveShadcnRegistry([libraryItem("plain")], "fixture");
  options = {
    trustFlags: [],
    interactive: false,
    projectDir: scratch,
    cliVersion,
    adapters: {
      cache: createRegistryCache({ dir: join(scratch, "modules") }),
      env: { XDG_CACHE_HOME: join(scratch, "cache"), XDG_CONFIG_HOME: join(scratch, "config") },
    },
  };
});

afterAll(async () => {
  await Promise.all([fixture.stop(), rival.stop(), twin.stop()]);
  await removeShadcnFixtures();
  await rm(scratch, { recursive: true, force: true });
});

describe("item URLs", () => {
  test("a URL that is not an item JSON file is refused", () => {
    for (const address of [
      "https://example.com/r/button",
      "https://example.com/r/button.json?token=1",
      "https://example.com/r/button.json#top",
    ]) {
      let failure: unknown;
      try {
        itemUrl(address);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(RegistryError);
      expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_SOURCE_UNSUPPORTED");
    }
  });

  test("an item URL splits into its Registry and decoded item name", () => {
    const { source, item } = itemUrl("https://example.com/r/styles/new%20york.json");
    expect(item).toBe("new york");
    expect(source.kind).toBe("shadcn");
  });
});

describe("registryDependencies that name a local path", () => {
  test("the item is refused because a path is read only as an aokit Registry", async () => {
    const set = await openFixtureSet();
    const failure = await rejection(
      openShadcnAddresses(set, { registries: {} }, ["@fixture/local-user"], {
        ...options,
        trustFlags: [fixture.url],
      }),
    );
    expect(failure).toBeInstanceOf(RegistryError);
    expect(failure instanceof RegistryError && failure.code).toBe("REGISTRY_SOURCE_UNSUPPORTED");
    expect(failure instanceof RegistryError && failure.message).toContain("./local.json");
  });

  test("an item the integrity cache cannot vouch for lists no dependencies", async () => {
    const set = await openFixtureSet();
    const registry = set.registries.get("fixture");
    if (registry === undefined) throw new Error("the fixture Registry was not opened");
    const cache = createRegistryCache({ dir: join(scratch, "failing-modules") });
    const wrapped = await withRegistryDependencies(
      registry,
      [],
      { ...cache, get: () => Promise.reject(new Error("cache unreadable")) },
      fixture.url,
      undefined,
    );
    const name = "@fixture/local-user";
    const version = await wrapped.version(name, wrapped.selectableVersions(name).at(-1) ?? "");
    expect(itemDependencies.get(version)).toEqual([]);
  });
});

describe("item URLs of another host", () => {
  test("a new Registry is opened, trusted on its own and added to the set", async () => {
    const set = await openFixtureSet();
    const addressed = await openShadcnAddresses(
      set,
      { registries: {} },
      [`${rival.url}/plain.json`],
      {
        ...options,
        trustFlags: [fixture.url, rival.url],
        adapters: { ...options.adapters, userConfig: { trustedRegistries: [] } },
      },
    );
    expect(addressed.names).toEqual(["@official/plain"]);
    expect(addressed.set.registries.has("official")).toBe(true);
    expect(addressed.set.entries["official"]).toBeDefined();
  });

  test("a host declaring the name of an opened Registry from elsewhere clashes", async () => {
    const set = await openFixtureSet();
    const failure = await rejection(
      openShadcnAddresses(set, { registries: {} }, [`${twin.url}/plain.json`], {
        ...options,
        trustFlags: [fixture.url, twin.url],
      }),
    );
    expect(failure).toBeInstanceOf(AokitError);
    expect(failure instanceof AokitError && failure.code).toBe("INVALID_INPUT");
    expect(failure instanceof AokitError && failure.message).toContain('"fixture"');
  });
});

describe("Registries that share a name", () => {
  test("a shadcn --registry named like the bundled one clashes with it", async () => {
    const failure = await rejection(
      loadCreateRegistries(rival.url, [], cliVersion, {
        projectDir: scratch,
        trustFlags: [rival.url],
        adapters: options.adapters,
      }),
    );
    expect(failure).toBeInstanceOf(AokitError);
    expect(failure instanceof AokitError && failure.message).toContain('"official"');
  });

  test("two Lockfile Registries declaring one name from different sources clash", async () => {
    const copy = join(scratch, "registry-copy");
    await cp(builtRegistry, copy, { recursive: true });
    const failure = await rejection(
      openProjectRegistries(
        { registries: { first: entry(builtRegistry), second: entry(copy) } },
        options,
      ),
    );
    expect(failure).toBeInstanceOf(AokitError);
    expect(failure instanceof AokitError && failure.code).toBe("INVALID_INPUT");
  });

  test("a --registry naming a Lockfile key reuses that Registry", async () => {
    const set = await openProjectRegistries(
      {
        registries: { official: { source: builtRegistry, release: "r", minCliVersion: "0.0.0" } },
      },
      { ...options, registryFlag: "official" },
    );
    expect(set.flagged).toBe("official");
    expect(set.registries.get("official")?.source).toEqual({ kind: "local", path: builtRegistry });
  });
});
