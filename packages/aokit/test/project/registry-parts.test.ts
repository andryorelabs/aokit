import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { currentLockfileVersion, type Lockfile } from "../../src/lockfile/schema.ts";
import type {
  LoadProjectRegistriesOptions,
  LoadRegistryOptions,
  OpenProjectRegistryOptions,
  RegistryDependency,
  RegistrySourceContext,
  ShadcnAddressing,
  SnapshotScope,
} from "../../src/project/registry.ts";
import { requiredRegistry, resolveRegistrySource } from "../../src/project/registry/context.ts";
import { loadCreateRegistries, toPipelineModule } from "../../src/project/registry/create.ts";
import { parseRegistryDependency } from "../../src/project/registry/dependencies.ts";
import { assertCatalogDepsAuthenticated } from "../../src/project/registry/kept-index.ts";
import { openSource } from "../../src/project/registry/open-source.ts";
import {
  openProjectRegistries,
  resolutionOrder,
} from "../../src/project/registry/project-registries.ts";
import { openShadcnAddresses } from "../../src/project/registry/shadcn-addresses.ts";
import { openProjectRegistry, snapshotRegistry } from "../../src/project/registry/snapshot.ts";
import { createRegistryCache } from "../../src/registry/cache.ts";
import { type Registry, RegistryError } from "../../src/registry/index.ts";

const builtRegistry = resolve(import.meta.dir, "../../../../registry");
const cliVersion = "99.0.0";

let scratch = "";
let options: LoadProjectRegistriesOptions;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "aokit-project-registry-parts-"));
  const env = { XDG_CACHE_HOME: join(scratch, "cache"), XDG_CONFIG_HOME: join(scratch, "config") };
  options = {
    trustFlags: [],
    interactive: false,
    projectDir: scratch,
    cliVersion,
    adapters: { cache: createRegistryCache({ dir: join(scratch, "modules") }), env },
  };
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function openBuilt(): Promise<Registry> {
  const cache = createRegistryCache({ dir: join(scratch, "modules") });
  return openSource({ kind: "local", path: builtRegistry }, options, cache);
}

function lockfileWithout(): Lockfile {
  return {
    $schema: "https://aokit.andryore.dev/schema/lockfile/v2.json",
    lockfileVersion: currentLockfileVersion,
    cliVersion: "0.1.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: {},
    deps: {},
  };
}

describe("context", () => {
  const context: RegistrySourceContext = {
    projectDir: resolve("/work/app"),
    bundledRegistryPath: resolve("/opt/registry"),
  };

  test("a relative source resolves against the Project directory", () => {
    expect(resolveRegistrySource("../registry", context)).toBe(resolve("/work/registry"));
  });

  test("a remote source has no local directory", () => {
    expect(() => resolveRegistrySource("https://r.test", context)).toThrow(AokitError);
  });

  test("a Registry that was not opened is an internal error", () => {
    expect(() => requiredRegistry(new Map<string, Registry>(), "ghost")).toThrow(
      'Registry "ghost" was not opened',
    );
  });
});

describe("dependencies", () => {
  test("a bare item name is scoped to the Registry that lists it", () => {
    const parsed: RegistryDependency = parseRegistryDependency("button", { registry: "@acme" });
    expect(parsed).toEqual({ form: "bare", address: "@acme/button" });
  });

  test("an owner/repo/item#ref entry is a github: address", () => {
    expect(parseRegistryDependency("acme/ui/card#main", { registry: "acme" })).toEqual({
      form: "github",
      address: "github:acme/ui/card#main",
    });
  });

  test("an entry of no known form is refused", () => {
    expect(() => parseRegistryDependency("not an item", { registry: "acme" })).toThrow(
      RegistryError,
    );
  });
});

describe("project registries", () => {
  test("the --registry key is looked up first", () => {
    const registries = new Map<string, Pick<Registry, "source">>([
      ["official", { source: { kind: "bundled", path: "/bundled" } }],
      ["mine", { source: { kind: "local", path: "/work/registry" } }],
    ]);
    expect(resolutionOrder({ registries, flagged: "official" })).toEqual(["official", "mine"]);
  });

  test("a local --registry opens and needs no trust prompt", async () => {
    const set = await openProjectRegistries(undefined, {
      ...options,
      registryFlag: builtRegistry,
    });
    expect(set.flagged).toBe("official");
    expect(set.registries.get("official")?.source.kind).toBe("local");
  });
});

describe("open source, snapshot and create", () => {
  test("an online Registry needs no Catalog check against the Lockfile", async () => {
    const registry = await openBuilt();
    expect(() =>
      assertCatalogDepsAuthenticated(
        registry,
        { deps: {} },
        { deps: { zod: { source: "catalog", version: "9.9.9", owners: [], pinned: false } } },
      ),
    ).not.toThrow();
  });

  test("a snapshot answers only the versions its scope read", async () => {
    const registry = await openBuilt();
    const newest = registry.selectableVersions("oxc").at(-1) ?? "";
    const scope: SnapshotScope = { versions: [["oxc", newest]] };
    const snapshot = await snapshotRegistry(registry, "official", scope);
    expect(snapshot.version("oxc", newest)?.integrity).toBe(
      (await registry.version("oxc", newest)).integrity,
    );
    expect(snapshot.version("astro", registry.versions("astro").at(-1) ?? "")).toBeUndefined();
  });

  test("an Engine Module refuses a file its version does not ship", async () => {
    const registry = await openBuilt();
    const version = await registry.version("oxc", registry.selectableVersions("oxc").at(-1) ?? "");
    const module = toPipelineModule(version, "official");
    expect(module.registry).toBe("official");
    expect(() => module.readFile("no/such/file")).toThrow(AokitError);
  });

  test("create opens the --registry one for the native Modules", async () => {
    const createOptions: LoadRegistryOptions = { projectDir: scratch, adapters: options.adapters };
    const created = await loadCreateRegistries(builtRegistry, ["oxc"], cliVersion, createOptions);
    expect(created.native.key).toBe("official");
    expect(created.names).toEqual(["oxc"]);
    expect(created.available.some((module) => module.manifest.name === "oxc")).toBe(true);
  });

  test("a Lockfile that lists no Registry cannot be opened", async () => {
    const openOptions: OpenProjectRegistryOptions = { projectDir: scratch, cliVersion };
    const failure = await openProjectRegistry(lockfileWithout(), openOptions).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AokitError);
    expect(failure instanceof AokitError ? failure.message : "").toBe(
      "aokit.lock.json lists no Registry.",
    );
  });
});

describe("shadcn addresses", () => {
  test("plain Module names pass through without opening a Registry", async () => {
    const set = {
      registries: new Map<string, Registry>(),
      lockedRegistries: new Map<string, Registry>(),
      flagged: undefined,
      entries: {},
      movedPins: [],
      decisions: [],
    };
    const addressed: ShadcnAddressing = await openShadcnAddresses(
      set,
      { registries: {} },
      ["oxc", "next"],
      options,
    );
    expect(addressed.names).toEqual(["oxc", "next"]);
    expect(addressed.modules).toEqual([]);
  });
});
