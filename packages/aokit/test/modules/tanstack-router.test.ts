import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import tanstackRouterSource from "../../../../registry-src/tanstack-router/module.ts";
import { buildSelection } from "./support/index.ts";

const tanstackRouter = parseManifest(tanstackRouterSource);

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

describe("tanstack-router", () => {
  test.each([
    ["single", ""],
    ["monorepo", "apps/web/"],
  ] as const)(
    "overrides the vite-react router and registers the plugin (%s)",
    async (layout, directory) => {
      const { plan } = await build(layout, ["vite-react", "tanstack-router"]);
      const router = String(plan.vfs.read(`${directory}src/router.tsx`));
      expect(router).toContain("createRouter({ routeTree })");
      expect(router).not.toContain("Hello");
      expect(plan.vfs.has(`${directory}src/routes/__root.tsx`)).toBe(true);
      expect(plan.vfs.has(`${directory}src/routes/index.tsx`)).toBe(true);
      expect(plan.vfs.has(`${directory}src/routeTree.gen.ts`)).toBe(true);
      const config = String(plan.vfs.read(`${directory}vite.config.ts`));
      expect(config).toContain('import { tanstackRouter } from "@tanstack/router-plugin/vite";');
      expect(config).toContain('tanstackRouter({ target: "react", autoCodeSplitting: true })');
      expect(plan.vfs.has(".claude/skills/tanstack-router/SKILL.md")).toBe(true);
    },
  );

  test("puts dependencies in the right package per layout", async () => {
    const single = await build("single", ["vite-react", "tanstack-router"]);
    const root = packageSchema.parse(JSON.parse(String(single.plan.vfs.read("package.json"))));
    expect(root.dependencies?.["@tanstack/react-router"]).toBe("^1.170.46");
    expect(root.devDependencies?.["@tanstack/router-plugin"]).toBe("^1.169.0");
    const monorepo = await build("monorepo", ["vite-react", "tanstack-router"]);
    const web = packageSchema.parse(
      JSON.parse(String(monorepo.plan.vfs.read("apps/web/package.json"))),
    );
    expect(web.dependencies?.["@tanstack/react-router"]).toBe("catalog:");
    expect(web.devDependencies?.["@tanstack/router-plugin"]).toBe("catalog:");
  });

  test("documents the web.routes limitation in the agents Region", async () => {
    const { plan } = await build("single", ["vite-react", "tanstack-router"]);
    const agents = String(plan.vfs.read("AGENTS.md"));
    expect(agents).toContain("aokit:begin tanstack-router:agents");
    expect(agents).toContain("`web.routes` contributors no longer apply");
  });

  test("provides routing and requires web:spa and vite.plugins", () => {
    expect(tanstackRouter.provides.map((entry) => entry.capability)).toEqual(["routing"]);
    expect(tanstackRouter.requires).toEqual(["web:spa", "ext:vite.plugins@^1"]);
  });

  test("fails without a web:spa provider", async () => {
    const built = await buildSelection(["tanstack-router"], "single");
    expect(built.ok).toBe(false);
  });
});
