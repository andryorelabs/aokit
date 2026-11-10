import { expect, test } from "bun:test";
import { parseManifest, type ModuleManifest, type ModuleManifestInput } from "@aokit/module";
import { resolve } from "../../src/resolver/resolve.ts";
import { suggestModuleName } from "../../src/resolver/suggest.ts";
import type { ResolveFailure, ResolveSuccess } from "../../src/resolver/types.ts";

function mod(input: Omit<ModuleManifestInput, "version"> & { version?: string }): ModuleManifest {
  return parseManifest({ version: "1.0.0", ...input });
}

function expectOk(result: ReturnType<typeof resolve>): ResolveSuccess {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result;
}

function expectFailure(result: ReturnType<typeof resolve>): ResolveFailure {
  if (result.ok) {
    throw new Error("expected a failure");
  }
  return result;
}

function names(result: ResolveSuccess): string[] {
  return result.modules.map((entry) => entry.name);
}

const prisma = mod({ name: "prisma", provides: ["orm", "db:postgres"] });
const drizzle = mod({ name: "drizzle", provides: ["orm"] });
const betterAuth = mod({ name: "better-auth", requires: ["orm"] });

test("unmet requires with one provider is an error carrying the example message and a suggestion", () => {
  const result = expectFailure(resolve({ modules: ["better-auth"] }, [betterAuth, prisma]));
  expect(result.error.code).toBe("requirement_unmet");
  expect(result.error.message).toContain(
    'module "better-auth" requires capability "orm" but no selected module provides it.',
  );
  expect(result.error.message).toContain("providers: prisma (orm, db:postgres)");
  expect(result.error.fix).toContain("aokit add prisma");
  expect(result.suggestions).toEqual([
    { module: "prisma", requiredBy: "better-auth", requirement: "orm", applied: false },
  ]);
});

test("acceptSuggestions applies a single-provider suggestion and orders it first", () => {
  const result = expectOk(
    resolve({ modules: ["better-auth"] }, [betterAuth, prisma], { acceptSuggestions: true }),
  );
  expect(names(result)).toEqual(["prisma", "better-auth"]);
  expect(result.modules[0]?.source).toBe("suggested");
  expect(result.suggestions).toEqual([
    { module: "prisma", requiredBy: "better-auth", requirement: "orm", applied: true },
  ]);
});

test("suggestions chain through transitive requirements", () => {
  const base = mod({ name: "base", provides: ["db:postgres"] });
  const orm = mod({ name: "orm-x", provides: ["orm"], requires: ["db:postgres"] });
  const auth = mod({ name: "auth", requires: ["orm"] });
  const result = expectOk(
    resolve({ modules: ["auth"] }, [auth, orm, base], { acceptSuggestions: true }),
  );
  expect(names(result)).toEqual(["base", "orm-x", "auth"]);
});

test("ambiguous providers are an error listing them, never auto-added", () => {
  const tailwind = mod({ name: "tailwind4", requires: ["web"] });
  const providers = ["next", "vite-react", "astro"].map((name) => mod({ name, provides: ["web"] }));
  const result = expectFailure(
    resolve({ modules: ["tailwind4"] }, [tailwind, ...providers], { acceptSuggestions: true }),
  );
  expect(result.error.code).toBe("requirement_ambiguous");
  expect(result.error.providers).toEqual(["astro", "next", "vite-react"]);
  expect(result.error.message).toContain("astro, next, vite-react");
  expect(result.suggestions).toEqual([]);
});

test("a requirement with no provider anywhere is an unmet error without suggestions", () => {
  const result = expectFailure(resolve({ modules: ["better-auth"] }, [betterAuth]));
  expect(result.error.code).toBe("requirement_unmet");
  expect(result.error.providers).toBeUndefined();
  expect(result.suggestions).toEqual([]);
});

test("cardinality exceeded names the capability and providers", () => {
  const result = expectFailure(resolve({ modules: ["prisma", "drizzle"] }, [prisma, drizzle]));
  expect(result.error.code).toBe("cardinality_exceeded");
  expect(result.error.message).toBe(
    'capability "orm" allows at most 1 provider, but 2 are selected: drizzle, prisma.',
  );
  expect(result.error.fix).toBe("remove one of them from the selection.");
});

test("many cardinality allows coexisting providers", () => {
  const docker = mod({ name: "docker", provides: [{ capability: "deploy", cardinality: "many" }] });
  const coolify = mod({
    name: "coolify",
    provides: [{ capability: "deploy", cardinality: "many" }],
  });
  const result = expectOk(resolve({ modules: ["docker", "coolify"] }, [docker, coolify]));
  expect(names(result)).toEqual(["coolify", "docker"]);
  expect(result.warnings).toEqual([]);
});

test("cardinality disagreement warns and the stricter declaration wins", () => {
  const strict = mod({
    name: "a-deploy",
    provides: [{ capability: "deploy", cardinality: { max: 1 } }],
  });
  const loose = mod({
    name: "b-deploy",
    provides: [{ capability: "deploy", cardinality: "many" }],
  });
  const other = mod({
    name: "c-deploy",
    provides: [{ capability: "deploy", cardinality: "many" }],
  });
  const warned = expectOk(resolve({ modules: ["a-deploy"] }, [strict, loose]));
  expect(warned.warnings).toEqual([]);
  const result = expectFailure(
    resolve({ modules: ["a-deploy", "b-deploy", "c-deploy"] }, [strict, loose, other]),
  );
  expect(result.error.code).toBe("cardinality_exceeded");
  expect(result.warnings.map((warning) => warning.code)).toEqual(["cardinality_disagreement"]);
  const lenient = mod({
    name: "d-deploy",
    provides: [{ capability: "deploy", cardinality: { max: 2 } }],
  });
  const ok = expectOk(resolve({ modules: ["d-deploy", "b-deploy"] }, [lenient, loose]));
  expect(ok.warnings.map((warning) => warning.code)).toEqual(["cardinality_disagreement"]);
  expect(ok.warnings[0]?.capability).toBe("deploy");
});

test("conflicts against a selected module name", () => {
  const docker = mod({ name: "docker", conflicts: ["bare-metal"] });
  const bareMetal = mod({ name: "bare-metal" });
  const result = expectFailure(resolve({ modules: ["docker", "bare-metal"] }, [docker, bareMetal]));
  expect(result.error.code).toBe("module_conflict");
  expect(result.error.message).toContain('module "docker" conflicts with module "bare-metal"');
  expect(result.error.fix).toBe('choose one, or remove "bare-metal".');
});

test("conflicts against a provided capability", () => {
  const docker = mod({ name: "docker", conflicts: ["deploy"] });
  const coolify = mod({ name: "coolify", provides: ["deploy"] });
  const result = expectFailure(resolve({ modules: ["docker", "coolify"] }, [docker, coolify]));
  expect(result.error.code).toBe("module_conflict");
  expect(result.error.capability).toBe("deploy");
  expect(result.error.message).toContain('capability "deploy", provided by module "coolify"');
});

test("a conflict with an unselected module is fine", () => {
  const docker = mod({ name: "docker", conflicts: ["bare-metal"] });
  expectOk(resolve({ modules: ["docker"] }, [docker, mod({ name: "bare-metal" })]));
});

const next = mod({
  name: "next",
  extensionPoints: [
    { name: "web.providers", version: "1.2.0", target: "web", kind: "array", anchor: "providers" },
  ],
});

test("extension point range is matched with semver and orders the base first", () => {
  const posthog = mod({ name: "posthog", requires: ["ext:web.providers@^1"] });
  const result = expectOk(resolve({ modules: ["posthog", "next"] }, [posthog, next]));
  expect(names(result)).toEqual(["next", "posthog"]);
});

test("an unmet extension point range reports the provided version", () => {
  const posthog = mod({ name: "posthog", requires: ["ext:web.providers@^2"] });
  const result = expectFailure(resolve({ modules: ["posthog", "next"] }, [posthog, next]));
  expect(result.error.code).toBe("extension_point_unmet");
  expect(result.error.message).toBe(
    'module "posthog" requires extension point "web.providers@^2" but "next" provides 1.2.0.',
  );
  expect(result.error.fix).toContain("web.providers@^1");
});

test("a missing extension point with one registry provider is suggested and applied on accept", () => {
  const posthog = mod({ name: "posthog", requires: ["ext:web.providers@^1"] });
  const failure = expectFailure(resolve({ modules: ["posthog"] }, [posthog, next]));
  expect(failure.error.code).toBe("extension_point_unmet");
  expect(failure.suggestions[0]?.module).toBe("next");
  const result = expectOk(
    resolve({ modules: ["posthog"] }, [posthog, next], { acceptSuggestions: true }),
  );
  expect(names(result)).toEqual(["next", "posthog"]);
});

test("a dependency cycle is reported with the modules involved", () => {
  const first = mod({ name: "alpha", provides: ["a"], requires: ["b"] });
  const second = mod({ name: "beta", provides: ["b"], requires: ["a"] });
  const result = expectFailure(resolve({ modules: ["alpha", "beta"] }, [first, second]));
  expect(result.error.code).toBe("dependency_cycle");
  expect(result.error.message).toBe(
    "modules form a dependency cycle: alpha requires beta requires alpha.",
  );
  expect(result.error.providers).toEqual(["alpha", "beta"]);
});

test("a module requiring its own capability does not count as satisfied or cyclic", () => {
  const selfish = mod({ name: "selfish", provides: ["x"], requires: ["x"] });
  const result = expectFailure(resolve({ modules: ["selfish"] }, [selfish]));
  expect(result.error.code).toBe("requirement_unmet");
});

test("locked modules count as selected and satisfy requirements", () => {
  const result = expectOk(
    resolve({ modules: ["better-auth"], locked: ["prisma"] }, [betterAuth, prisma]),
  );
  expect(result.modules.map((entry) => [entry.name, entry.source])).toEqual([
    ["prisma", "locked"],
    ["better-auth", "selected"],
  ]);
  expect(result.suggestions).toEqual([]);
});

test("locked modules take part in cardinality checks", () => {
  const result = expectFailure(
    resolve({ modules: ["drizzle"], locked: ["prisma"] }, [prisma, drizzle]),
  );
  expect(result.error.code).toBe("cardinality_exceeded");
});

test("a module in both selection and lockfile counts as selected", () => {
  const result = expectOk(resolve({ modules: ["prisma"], locked: ["prisma"] }, [prisma]));
  expect(result.modules.map((entry) => entry.source)).toEqual(["selected"]);
});

test("an unknown module is a coded error", () => {
  const result = expectFailure(resolve({ modules: ["ghost"] }, [prisma]));
  expect(result.error.code).toBe("unknown_module");
  expect(result.error.module).toBe("ghost");
  const locked = expectFailure(resolve({ modules: [], locked: ["ghost"] }, [prisma]));
  expect(locked.error.code).toBe("unknown_module");
});

test("the fix of a missing dependency names --modules in create and aokit add in add", () => {
  const registry = [betterAuth, prisma];
  const create = expectFailure(
    resolve({ modules: ["better-auth"] }, registry, { intent: "create" }),
  );
  expect(create.error.fix).toBe(
    'add "prisma" to --modules, for example --modules better-auth,prisma',
  );
  expect(create.error.fix).not.toContain("--yes");
  expect(create.error.fix).not.toContain("--module ");
  const added = expectFailure(resolve({ modules: ["better-auth"] }, registry, { intent: "add" }));
  expect(added.error.fix).toBe("aokit add prisma");
});

test("an ambiguous requirement fix is per intent and never mentions --module", () => {
  const registry = [betterAuth, prisma, drizzle];
  const create = expectFailure(
    resolve({ modules: ["better-auth"] }, registry, { intent: "create" }),
  );
  expect(create.error.fix).toContain("--modules better-auth,drizzle");
  expect(create.error.fix).not.toContain("--module ");
  const added = expectFailure(resolve({ modules: ["better-auth"] }, registry, { intent: "add" }));
  expect(added.error.fix).toContain("aokit add drizzle");
});

test("an unknown module suggests a close name and points to aokit list", () => {
  const close = expectFailure(resolve({ modules: ["prismo"] }, [prisma]));
  expect(close.error.fix).toContain('did you mean "prisma"?');
  expect(close.error.fix).toContain("aokit list");
  const far = expectFailure(resolve({ modules: ["zzzzzzzz"] }, [prisma]));
  expect(far.error.fix).not.toContain("did you mean");
  expect(far.error.fix).toContain("aokit list");
});

test("suggestModuleName matches by edit distance and containment", () => {
  expect(suggestModuleName("nextjs", ["next", "oxc"])).toBe("next");
  expect(suggestModuleName("tailwnd4", ["tailwind4", "oxc"])).toBe("tailwind4");
  expect(suggestModuleName("qqqq", ["next", "oxc"])).toBeUndefined();
});

test("order is topological with codepoint tie-break regardless of input order", () => {
  const registry = [
    mod({ name: "zeta" }),
    mod({ name: "alpha", requires: ["base"] }),
    mod({ name: "base-mod", provides: ["base"] }),
    mod({ name: "aa-first" }),
    mod({ name: "mid", requires: ["base"] }),
  ];
  const input = ["zeta", "alpha", "base-mod", "aa-first", "mid"];
  const expected = ["aa-first", "base-mod", "alpha", "mid", "zeta"];
  expect(names(expectOk(resolve({ modules: input }, registry)))).toEqual(expected);
  expect(
    names(expectOk(resolve({ modules: [...input].toReversed() }, [...registry].toReversed()))),
  ).toEqual(expected);
});

test("an inert file override is a warning", () => {
  const layout = mod({
    name: "fancy-layout",
    override: [{ file: "web:src/app/layout.tsx", reason: "replaces the shell" }],
  });
  const result = expectOk(resolve({ modules: ["fancy-layout"] }, [layout]));
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]?.code).toBe("override_inert");
  expect(result.warnings[0]?.module).toBe("fancy-layout");
});

test("an override of an item another selected module produces is not a warning", () => {
  const baseLayout = mod({
    name: "next",
    files: [{ from: "layout.tsx", to: "src/app/layout.tsx", target: "web" }],
  });
  const layout = mod({
    name: "fancy-layout",
    override: [{ file: "web:src/app/layout.tsx", reason: "replaces the shell" }],
  });
  const result = expectOk(resolve({ modules: ["fancy-layout", "next"] }, [layout, baseLayout]));
  expect(result.warnings).toEqual([]);
});

test("an inert op override is a warning and a matching one is not", () => {
  const producer = mod({
    name: "producer",
    ops: [
      {
        op: "addToArray",
        target: "web",
        extensionPoint: "web.providers",
        range: "^1",
        element: "A()",
      },
    ],
  });
  const overrider = mod({
    name: "overrider",
    override: [{ op: "addToArray:web:web.providers", reason: "replace" }],
  });
  const matched = expectOk(resolve({ modules: ["producer", "overrider"] }, [producer, overrider]));
  expect(matched.warnings).toEqual([]);
  const inert = expectOk(resolve({ modules: ["overrider"] }, [overrider]));
  expect(inert.warnings.map((warning) => warning.code)).toEqual(["override_inert"]);
});

test("resolve does not mutate its inputs", () => {
  const registry = [betterAuth, prisma];
  const snapshot = structuredClone(registry);
  const modules = ["better-auth"];
  resolve({ modules }, registry, { acceptSuggestions: true });
  expect(registry).toEqual(snapshot);
  expect(modules).toEqual(["better-auth"]);
});

const authStack = {
  vite: mod({
    name: "vite-react",
    provides: [
      { capability: "web", cardinality: { max: 1 } },
      { capability: "web:spa", cardinality: { max: 1 } },
    ],
  }),
  next: mod({
    name: "next",
    provides: [
      { capability: "web", cardinality: { max: 1 } },
      { capability: "web:app-router", cardinality: { max: 1 } },
    ],
  }),
  prisma: mod({
    name: "prisma",
    provides: [
      { capability: "orm", cardinality: { max: 1 } },
      { capability: "orm:prisma", cardinality: { max: 1 } },
    ],
    extensionPoints: [
      { name: "db.schema", version: "1.0.0", target: "db", kind: "array", anchor: "schema" },
    ],
  }),
  auth: mod({
    name: "better-auth",
    provides: ["auth"],
    requires: ["orm:prisma", "web:app-router", "ext:db.schema@^1"],
  }),
};

test("several unmet requirements are reported together, noting a web provider that cannot coexist", () => {
  const { vite, next: nextModule, prisma: prismaModule, auth } = authStack;
  const failure = expectFailure(
    resolve({ modules: ["vite-react", "better-auth"] }, [vite, nextModule, prismaModule, auth], {
      intent: "create",
    }),
  );
  expect(failure.error.code).toBe("requirement_unmet");
  expect(failure.error.requirements).toEqual(["ext:db.schema@^1", "orm:prisma", "web:app-router"]);
  expect(failure.error.message.match(/web:app-router/g)).toHaveLength(1);
  expect(failure.error.message.match(/orm:prisma/g)).toHaveLength(1);
  expect(failure.error.message).toContain('"vite-react"');
  expect(failure.error.fix).toContain('"better-auth" currently needs');
  expect(failure.error.fix).toContain("aokit list");
  expect(failure.error.fix).toContain("module-catalog");
});

test("several unmet requirements that can all be added get one combined fix", () => {
  const { next: nextModule, prisma: prismaModule, auth } = authStack;
  const registry = [nextModule, prismaModule, auth];
  const created = expectFailure(
    resolve({ modules: ["better-auth"] }, registry, { intent: "create" }),
  );
  expect(created.error.fix).toContain("--modules better-auth,next,prisma");
  expect(created.error.fix).toContain('"next"');
  expect(created.error.fix).toContain('"prisma"');
  const added = expectFailure(resolve({ modules: ["better-auth"] }, registry, { intent: "add" }));
  expect(added.error.fix).toContain("aokit add");
});

test("a single unmet requirement keeps the one-line hint", () => {
  const { prisma: prismaModule } = authStack;
  const lonely = mod({ name: "lonely", requires: ["orm:prisma"] });
  const failure = expectFailure(
    resolve({ modules: ["lonely"] }, [lonely, prismaModule], { intent: "create" }),
  );
  expect(failure.error.requirements).toBeUndefined();
  expect(failure.error.fix).toBe('add "prisma" to --modules, for example --modules lonely,prisma');
});
