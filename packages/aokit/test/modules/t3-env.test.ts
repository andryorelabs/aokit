import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "@aokit/module";
import { z } from "zod";
import { type EngineContext, type EngineModule, buildPlan } from "../../src/engine/index.ts";
import t3Env from "../../../../registry-src/t3-env/module.ts";
import { buildSelection, draftCatalog } from "./support/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

const t3EnvModule: EngineModule = {
  manifest: parseManifest(t3Env),
  readFile: (from) =>
    readFileSync(
      join(import.meta.dir, "..", "..", "..", "..", "registry-src", "t3-env", from),
      "utf8",
    ),
};

const databaseModule: EngineModule = {
  manifest: parseManifest({
    name: "database",
    version: "1.0.0",
    description: "Fixture Module.",
    env: [
      {
        key: "DATABASE_URL",
        scope: "root",
        schema: "z.url()",
        example: "postgres://localhost/app",
      },
      { key: "PUBLIC_API_URL", scope: "root", schema: "z.url()", visibility: "client" },
    ],
  }),
  readFile: () => "",
};

const packageSchema = z.object({ dependencies: z.record(z.string(), z.string()) });

test.each([
  ["single", "src/env.ts", "package.json"],
  ["monorepo", "packages/config/src/env.ts", "package.json"],
] as const)("t3-env writes env.ts in the config Target (%s)", async (layout, envPath, manifest) => {
  const built = await buildSelection(["t3-env"], layout);
  if (!built.ok) throw new Error(built.error.message);
  const text = String(built.plan.vfs.read(envPath));
  expect(text).toContain("const server = {};");
  expect(text).toContain("const client = {};");
  const parsed = packageSchema.parse(JSON.parse(String(built.plan.vfs.read(manifest))));
  expect(parsed.dependencies["@t3-oss/env-core"]).toBe("^0.13.11");
  expect(parsed.dependencies["zod"]).toBe("^4.6.7");
});

test("t3-env appends its agents Region", async () => {
  const built = await buildSelection(["t3-env"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("aokit:begin t3-env:agents");
  expect(agents).toContain("## t3-env");
});

test.each([
  ["single", "src/env.ts"],
  ["monorepo", "packages/config/src/env.ts"],
] as const)(
  "env.ts validates a server var another Module contributes (%s)",
  async (layout, envPath) => {
    const plan = await buildPlan({
      modules: [databaseModule, t3EnvModule],
      layout,
      answers: {},
      catalog: draftCatalog(),
      context,
    });
    const text = String(plan.vfs.read(envPath));
    expect(text).toContain("const server = { DATABASE_URL: z.url() };");
    expect(text).toContain("const client = { PUBLIC_API_URL: z.url() };");
  },
);

test("without t3-env the contributed schema is skipped and no env.ts is written", async () => {
  const plan = await buildPlan({
    modules: [databaseModule],
    layout: "single",
    answers: {},
    catalog: draftCatalog(),
    context,
  });
  expect(plan.vfs.has("src/env.ts")).toBe(false);
});
