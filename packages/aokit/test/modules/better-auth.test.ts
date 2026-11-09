import { expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import { z } from "zod";
import betterAuth from "../../../../registry-src/better-auth/module.ts";
import { buildSelection } from "./support/index.ts";

const selection = ["next", "prisma", "better-auth"];

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

test.each([
  ["single", "src/lib", "src/app/api/auth/[...all]/route.ts", "src/db/schema"],
  ["monorepo", "apps/web/src/lib", "apps/web/src/app/api/auth/[...all]/route.ts", "packages/db"],
] as const)("better-auth writes its files in the web Target (%s)", async (layout, lib, route) => {
  const built = await buildSelection(selection, layout);
  if (!built.ok) throw new Error(built.error.message);
  const { vfs } = built.plan;
  const auth = String(vfs.read(`${lib}/auth.ts`));
  expect(auth).toContain("betterAuth(");
  expect(auth).toContain("prismaAdapter");
  expect(auth).not.toContain("{{");
  expect(String(vfs.read(`${lib}/auth-client.ts`))).toContain("createAuthClient");
  expect(String(vfs.read(route))).toContain("toNextJsHandler(auth)");
  expect(String(vfs.read(".claude/skills/better-auth/SKILL.md"))).toContain("name: better-auth");
});

test("better-auth appends its models to the db.schema Region", async () => {
  const built = await buildSelection(selection, "single");
  if (!built.ok) throw new Error(built.error.message);
  const schema = String(built.plan.vfs.read("src/db/prisma/schema.prisma"));
  expect(schema).toContain("// aokit:begin better-auth:schema");
  expect(schema).toContain("model Session {");
  expect(schema).toContain("model Verification {");
});

test("better-auth places dependencies per Target", async () => {
  const mono = await buildSelection(selection, "monorepo");
  if (!mono.ok) throw new Error(mono.error.message);
  const web = packageSchema.parse(JSON.parse(String(mono.plan.vfs.read("apps/web/package.json"))));
  const db = packageSchema.parse(
    JSON.parse(String(mono.plan.vfs.read("packages/db/package.json"))),
  );
  expect(web.dependencies?.["better-auth"]).toBe("catalog:");
  expect(db.dependencies?.["better-auth"]).toBeUndefined();
  expect(db.devDependencies?.["@better-auth/cli"]).toBe("catalog:");
  expect(web.devDependencies?.["@better-auth/cli"]).toBeUndefined();

  const single = await buildSelection(selection, "single");
  if (!single.ok) throw new Error(single.error.message);
  const manifest = packageSchema.parse(JSON.parse(String(single.plan.vfs.read("package.json"))));
  expect(manifest.dependencies?.["better-auth"]).toBe("^1.7.18");
  expect(manifest.devDependencies?.["@better-auth/cli"]).toBe("^1.4.21");
});

test("better-auth declares placeholder env examples and never a secret value", async () => {
  const built = await buildSelection(selection, "single");
  if (!built.ok) throw new Error(built.error.message);
  const env = String(built.plan.vfs.read(".env"));
  expect(env).toContain("BETTER_AUTH_SECRET=replace-with");
  expect(env).toContain("BETTER_AUTH_URL=http://localhost:3000");
});

test("better-auth does not write src/proxy.ts", () => {
  const manifest = parseManifest(betterAuth);
  const targets = manifest.files.map((file) => file.to);
  expect(targets.some((path) => path.endsWith("proxy.ts"))).toBe(false);
  expect(manifest.provides.map((entry) => entry.capability)).toEqual(["auth"]);
});

test("better-auth appends its agents Region", async () => {
  const built = await buildSelection(selection, "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("aokit:begin better-auth:agents");
  expect(agents).toContain("## better-auth");
});

test.each([
  [["better-auth"], "db.schema@^1"],
  [["prisma", "better-auth"], "web:app-router"],
] as const)("better-auth fails without its requirements (%j)", async (names, missing) => {
  const built = await buildSelection(names, "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain(missing);
});
