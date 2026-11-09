import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import starlightSource from "../../../../registry-src/starlight/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const starlight = parseManifest(starlightSource);

async function build(layout: "single" | "monorepo", names: readonly string[]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

describe("starlight", () => {
  test.each([
    ["single", ""],
    ["monorepo", "apps/web/"],
  ] as const)("registers the integration and the docs content (%s)", async (layout, directory) => {
    const { plan } = await build(layout, ["astro", "starlight"]);
    const config = String(plan.vfs.read(`${directory}astro.config.ts`));
    expect(config).toContain('import starlight from "@astrojs/starlight";');
    expect(config).toContain('starlight({ title: "Docs" })');
    expect(plan.vfs.has(`${directory}src/content.config.ts`)).toBe(true);
    expect(plan.vfs.has(`${directory}src/content/docs/guides/example.mdx`)).toBe(true);
    expect(plan.vfs.has(".claude/skills/starlight-docs/SKILL.md")).toBe(true);
  });

  test("overrides the astro index page with the docs landing", async () => {
    const { plan } = await build("single", ["astro", "starlight"]);
    const index = String(plan.vfs.read("src/pages/index.astro"));
    expect(index).toContain("Documentation");
    expect(index).not.toContain("Counter");
  });

  test("puts the dependency in the web package in a monorepo", async () => {
    const { plan } = await build("monorepo", ["astro", "starlight"]);
    const web = packageSchema.parse(JSON.parse(String(plan.vfs.read("apps/web/package.json"))));
    expect(web.dependencies?.["@astrojs/starlight"]).toBe("catalog:");
    const single = await build("single", ["astro", "starlight"]);
    const root = packageSchema.parse(JSON.parse(String(single.plan.vfs.read("package.json"))));
    expect(root.dependencies?.["@astrojs/starlight"]).toBe("^0.42.10");
  });

  test("appends the agents Region", async () => {
    const { plan } = await build("single", ["astro", "starlight"]);
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin starlight:agents");
  });

  test("fails without astro", async () => {
    const built = await buildSelection(["starlight"], "single");
    expect(built.ok).toBe(false);
  });

  test("provides docs-site and requires the astro integrations Extension point", () => {
    expect(starlight.provides.map((entry) => entry.capability)).toEqual(["docs-site"]);
    expect(starlight.requires).toEqual(["ext:astro.integrations@^1"]);
  });
});
