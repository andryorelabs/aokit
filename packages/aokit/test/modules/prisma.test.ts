import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifest } from "@aokit/module";
import { z } from "zod";
import { type EngineContext, type EngineModule, buildPlan } from "../../src/engine/index.ts";
import prisma from "../../../../registry-src/prisma/module.ts";
import t3Env from "../../../../registry-src/t3-env/module.ts";
import { buildSelection, draftCatalog } from "./support/index.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };

function sourceModule(name: string, module: unknown): EngineModule {
  return {
    manifest: parseManifest(module),
    readFile: (from) =>
      readFileSync(
        join(import.meta.dir, "..", "..", "..", "..", "registry-src", name, from),
        "utf8",
      ),
  };
}

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each([
  ["single", "src/db"],
  ["monorepo", "packages/db"],
] as const)(
  "prisma writes the schema, config and client in the db Target (%s)",
  async (layout, dbPath) => {
    const built = await buildSelection(["prisma"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    const schema = String(vfs.read(`${dbPath}/prisma/schema.prisma`));
    expect(schema).toContain('provider = "prisma-client"');
    expect(schema).toContain('provider = "postgresql"');
    expect(String(vfs.read(`${dbPath}/prisma.config.ts`))).toContain('env("DATABASE_URL")');
    expect(String(vfs.read(`${dbPath}/client.ts`))).toContain("PrismaPg");
    expect(String(vfs.read(".env"))).toContain("DATABASE_URL=");
    expect(String(vfs.read(".claude/skills/prisma/SKILL.md"))).toContain("name: prisma");
  },
);

test.each([
  ["single", "package.json"],
  ["monorepo", "packages/db/package.json"],
] as const)(
  "prisma pins its Toolchain group and places dependencies (%s)",
  async (layout, manifestPath) => {
    const exact = layout === "single";
    const built = await buildSelection(["prisma"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const manifest = packageSchema.parse(JSON.parse(String(built.plan.vfs.read(manifestPath))));
    expect(manifest.dependencies["@prisma/client"]).toBe(exact ? "7.10.1" : "catalog:");
    expect(manifest.dependencies["@prisma/adapter-pg"]).toBe(exact ? "7.10.1" : "catalog:");
    expect(manifest.dependencies["pg"]).toBe(exact ? "^8.23.1" : "catalog:");
    expect(manifest.devDependencies["prisma"]).toBe(exact ? "7.10.1" : "catalog:");
  },
);

test("prisma declares the db.schema region Extension point and provides orm", () => {
  const manifest = parseManifest(prisma);
  expect(manifest.provides.map((entry) => entry.capability)).toEqual(["orm", "orm:prisma"]);
  expect(manifest.requires).toEqual([]);
  expect(manifest.extensionPoints).toContainEqual({
    name: "db.schema",
    version: "1.0.0",
    target: "db",
    kind: "region",
    anchor: "schema",
    file: "prisma/schema.prisma",
  });
});

test("prisma appends its agents Region", async () => {
  const built = await buildSelection(["prisma"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("aokit:begin prisma:agents");
  expect(agents).toContain("## prisma");
});

test("prisma works without postgres-compose", async () => {
  const built = await buildSelection(["prisma"], "single");
  expect(built.ok).toBe(true);
});

test.each([
  ["single", "src/env.ts"],
  ["monorepo", "packages/config/src/env.ts"],
] as const)("prisma routes DATABASE_URL to t3-env when selected (%s)", async (layout, envPath) => {
  const plan = await buildPlan({
    modules: [sourceModule("prisma", prisma), sourceModule("t3-env", t3Env)],
    layout,
    answers: {},
    catalog: draftCatalog(),
    context,
  });
  expect(String(plan.vfs.read(envPath))).toContain("DATABASE_URL: z.url()");
});
