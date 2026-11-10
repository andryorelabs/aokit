import { expect, test } from "bun:test";
import { type ModuleManifestInput } from "@aokit/module";
import { type EngineContext, type EngineModule, buildPlan } from "../../src/engine/index.ts";
import { fixtureManifest } from "../helpers/fixture-manifest.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

const envSource = `const server = {};
const client = {};
export const env = createEnv({ server, client });
`;

function moduleOf(
  manifest: Partial<ModuleManifestInput> & { name: string },
  sources: Record<string, string> = {},
): EngineModule {
  return {
    manifest: fixtureManifest(manifest),
    readFile: (from) => sources[from] ?? "",
  };
}

const t3Env = moduleOf(
  {
    name: "t3-env",
    files: [{ from: "env.ts", to: "src/env.ts", target: "config" }],
    extensionPoints: ["server", "client"].map((side) => ({
      name: `env.${side}`,
      version: "1.0.0",
      target: "config" as const,
      kind: "object" as const,
      anchor: side,
      file: "src/env.ts",
    })),
  },
  { "env.ts": envSource },
);

const prisma = moduleOf({
  name: "prisma",
  env: [
    { key: "DATABASE_URL", scope: "root", schema: "z.url()", example: "postgres://x" },
    { key: "PUBLIC_API", scope: "root", schema: "z.string()", visibility: "client" },
    { key: "NO_SCHEMA", scope: "root" },
  ],
});

test("env schemas register at env.server and env.client when t3-env declares them", async () => {
  const plan = await buildPlan({
    modules: [t3Env, prisma],
    layout: "single",
    answers: {},
    context,
  });
  const text = String(plan.vfs.read("src/env.ts"));
  expect(text).toContain("const server = { DATABASE_URL: z.url() };");
  expect(text).toContain("const client = { PUBLIC_API: z.string() };");
  expect(text).not.toContain("NO_SCHEMA");
  expect(String(plan.vfs.read(".env"))).toContain("DATABASE_URL=postgres://x");
});

test("the schema registers when the declaring Module is built before t3-env", async () => {
  const plan = await buildPlan({
    modules: [prisma, t3Env],
    layout: "single",
    answers: {},
    context,
  });
  expect(String(plan.vfs.read("src/env.ts"))).toContain(
    "const server = { DATABASE_URL: z.url() };",
  );
});

test("without t3-env the schema is skipped and no env.ts is written", async () => {
  const plan = await buildPlan({ modules: [prisma], layout: "single", answers: {}, context });
  expect(plan.vfs.has("src/env.ts")).toBe(false);
  expect(String(plan.vfs.read(".env"))).toContain("DATABASE_URL=postgres://x");
});

test("the monorepo registers in packages/config/src/env.ts", async () => {
  const plan = await buildPlan({
    modules: [t3Env, prisma],
    layout: "monorepo",
    answers: {},
    context,
  });
  expect(String(plan.vfs.read("packages/config/src/env.ts"))).toContain("DATABASE_URL: z.url()");
});
