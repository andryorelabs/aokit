import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import honoZodValidatorSource from "../../../../registry-src/hono-zod-validator/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const honoZodValidator = parseManifest(honoZodValidatorSource);

async function build(
  layout: "single" | "monorepo",
  names: readonly string[] = ["hono", "hono-zod-validator"],
) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("hono-zod-validator", () => {
  test("single contributes a zValidator sample route through server.routes", async () => {
    const app = String((await build("single")).read("src/app.ts"));
    expect(app).toContain('import { zValidator } from "@hono/zod-validator"');
    expect(app).toContain('import { z } from "zod"');
    expect(app).toContain('"/echo": new Hono().post("/", zValidator("json"');
  });

  test("monorepo contributes the route to the server app and places dependencies", async () => {
    const vfs = await build("monorepo");
    expect(String(vfs.read("apps/server/src/app.ts"))).toContain("zValidator");
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("apps/server/package.json"))));
    expect(manifest.dependencies).toMatchObject({
      "@hono/zod-validator": "catalog:",
      zod: "catalog:",
    });
  });

  test("single places the validator in the root package.json", async () => {
    const manifest = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(manifest.dependencies).toMatchObject({ "@hono/zod-validator": "^0.9.1" });
  });

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin hono-zod-validator:agents",
    );
  });

  test("requires server.routes", () => {
    expect(honoZodValidator.requires).toEqual(["ext:server.routes@^1"]);
  });

  test("fails without hono, naming the missing requirement", async () => {
    const built = await buildSelection(["hono-zod-validator"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("server.routes");
  });
});
