import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import astroSource from "../../../../registry-src/astro/module.ts";
import { buildSelection } from "./support/index.ts";

const astro = parseManifest(astroSource);

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z.array(z.string()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[] = ["astro"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

function manifestAt(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

describe("astro", () => {
  test("single writes the site base, the Skill and the dependencies", async () => {
    const { plan } = await build("single");
    expect(plan.vfs.paths()).toEqual([
      ".claude/skills/astro-page/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "astro.config.ts",
      "package.json",
      "src/components/Counter.tsx",
      "src/layouts/Layout.astro",
      "src/pages/index.astro",
      "src/styles.ts",
      "tsconfig.json",
    ]);
    const manifest = manifestAt(plan.vfs, "package.json");
    expect(manifest.scripts).toMatchObject({
      build: "bun run --cwd . astro build",
      dev: "bun run --cwd . astro dev",
      preview: "bun run --cwd . astro preview",
    });
    expect(manifest.dependencies).toMatchObject({
      "@astrojs/react": "^7.1.4",
      astro: "^7.4.7",
      react: "^19.3.1",
      "react-dom": "^19.3.1",
    });
    expect(manifest.devDependencies).toMatchObject({ vite: "^8.3.5" });
  });

  test("monorepo puts the site files and dependencies in the web package", async () => {
    const { plan } = await build("monorepo");
    expect(plan.vfs.paths()).toEqual([
      ".claude/skills/astro-page/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "apps/web/astro.config.ts",
      "apps/web/package.json",
      "apps/web/src/components/Counter.tsx",
      "apps/web/src/layouts/Layout.astro",
      "apps/web/src/pages/index.astro",
      "apps/web/src/styles.ts",
      "apps/web/tsconfig.json",
      "package.json",
    ]);
    expect(manifestAt(plan.vfs, "package.json")).toMatchObject({
      scripts: { dev: "bun run --cwd apps/web astro dev" },
      workspaces: ["apps/web"],
    });
    expect(manifestAt(plan.vfs, "apps/web/package.json").dependencies).toMatchObject({
      "@astrojs/react": "catalog:",
      astro: "catalog:",
    });
  });

  test.each(["single", "monorepo"] as const)(
    "Layout.astro imports the stylesheet list that tailwind4 fills (%s)",
    async (layout) => {
      const { plan } = await build(layout, ["astro", "tailwind4"]);
      const directory = layout === "single" ? "" : "apps/web/";
      const layoutFile = String(plan.vfs.read(`${directory}src/layouts/Layout.astro`));
      expect(layoutFile).toContain('import "../styles";');
      const styles = String(plan.vfs.read(`${directory}src/styles.ts`));
      expect(styles).toContain('import "./styles.css";');
      expect(plan.vfs.has(`${directory}src/styles.css`)).toBe(true);
    },
  );

  test("appends the agents Region and a .gitignore Region", async () => {
    const { plan } = await build("single");
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin astro:agents");
    const ignore = String(plan.vfs.read(".gitignore"));
    expect(ignore).toContain("# aokit:begin astro:astro");
    expect(ignore).toContain(".astro");
  });

  test("conflicts with vite-react over the web capability", async () => {
    const built = await buildSelection(["astro", "vite-react"], "single");
    expect(built.ok).toBe(false);
  });

  test("provides web, web:react and web:static and declares the Extension points", () => {
    expect(astro.version).toBe("1.1.0");
    expect(astro.provides.map((entry) => entry.capability)).toEqual([
      "web",
      "web:react",
      "web:static",
    ]);
    expect(astro.extensionPoints.map((point) => `${point.name}@${point.version}`)).toEqual([
      "astro.integrations@1.0.0",
      "vite.plugins@1.0.0",
      "web.styles@1.0.0",
    ]);
  });
});
