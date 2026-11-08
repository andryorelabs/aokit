import { expect, test } from "bun:test";
import { type ModuleManifestInput, parseManifest } from "@aokit/module";
import type { LayoutName } from "../../src/engine/layout.ts";
import { type EngineContext, type EngineModule, buildPlan } from "../../src/engine/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function moduleOf(manifest: Partial<ModuleManifestInput> & { name: string }): EngineModule {
  return {
    manifest: parseManifest({ version: "1.0.0", ...manifest }),
    readFile: () => "",
  };
}

const auth = moduleOf({
  name: "auth",
  files: [{ from: "a.ts", to: "a.ts", target: "web" }],
  deps: {
    dependencies: {
      "better-auth": { range: "^1.0.0", target: "web" },
      "pg-adapter": { range: "^2.0.0", target: "db" },
      shared: { range: "^3.0.0" },
    },
    devDependencies: { "better-auth": { range: "^1.0.0", target: "db" } },
  },
});

async function build(layout: LayoutName) {
  return buildPlan({ modules: [auth], layout, answers: {}, context });
}

function parsed(plan: Awaited<ReturnType<typeof build>>, path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(String(plan.vfs.read(path)));
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

test("monorepo places each dependency in the package.json of its own Target", async () => {
  const plan = await build("monorepo");
  expect(parsed(plan, "apps/web/package.json")["dependencies"]).toEqual({
    "better-auth": "^1.0.0",
    shared: "^3.0.0",
  });
  expect(parsed(plan, "packages/db/package.json")).toMatchObject({
    dependencies: { "pg-adapter": "^2.0.0" },
    devDependencies: { "better-auth": "^1.0.0" },
  });
});

test("the single Layout collapses every Target into one package.json without duplicate keys", async () => {
  const plan = await build("single");
  const text = String(plan.vfs.read("package.json"));
  expect(plan.vfs.has("src/db/package.json")).toBe(false);
  expect(parsed(plan, "package.json")).toMatchObject({
    dependencies: { "better-auth": "^1.0.0", "pg-adapter": "^2.0.0", shared: "^3.0.0" },
  });
  expect(text.match(/"pg-adapter"/g)).toHaveLength(1);
  expect(text.match(/"dependencies"/g)).toHaveLength(1);
});

test("a catalog dependency on a workspace Target is written as catalog: and listed at the root", async () => {
  const plan = await buildPlan({
    modules: [
      moduleOf({
        name: "cat",
        deps: { dependencies: { zod: { range: "catalog", target: "db" } } },
      }),
    ],
    layout: "monorepo",
    answers: {},
    context,
    catalog: { dependencies: { zod: "^4.0.0" }, pinGroups: {} },
  });
  expect(parsed(plan, "packages/db/package.json")["dependencies"]).toEqual({ zod: "catalog:" });
  expect(parsed(plan, "package.json")["catalog"]).toEqual({ zod: "^4.0.0" });
});
