import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import nextSource from "../../../../registry-src/next/module.ts";
import { buildSelection } from "./support/index.ts";

const next = parseManifest(nextSource);

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z.array(z.string()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[] = ["next"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

function manifestAt(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

describe("next", () => {
  test("single writes the App Router base with scripts and dependencies", async () => {
    const { plan } = await build("single");
    expect(plan.vfs.paths()).toEqual([
      ".claude/skills/next/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "next.config.ts",
      "package.json",
      "src/app/layout.tsx",
      "src/app/page.tsx",
      "src/css.d.ts",
      "src/providers.tsx",
      "src/proxy.ts",
      "src/styles.ts",
      "tsconfig.json",
    ]);
    const manifest = manifestAt(plan.vfs, "package.json");
    expect(manifest.scripts).toMatchObject({
      build: "bun run --cwd . next build",
      dev: "bun run --cwd . next dev",
      start: "bun run --cwd . next start",
    });
    expect(manifest.dependencies).toMatchObject({
      next: "^16.4.5",
      react: "^19.3.1",
      "react-dom": "^19.3.1",
    });
    expect(manifest.devDependencies).toMatchObject({
      "babel-plugin-react-compiler": "^1.0.0",
    });
  });

  test("monorepo puts the web files and dependencies in the web package", async () => {
    const { plan } = await build("monorepo");
    expect(plan.vfs.has("apps/web/next.config.ts")).toBe(true);
    expect(plan.vfs.has("apps/web/src/proxy.ts")).toBe(true);
    expect(plan.vfs.has("apps/web/src/app/layout.tsx")).toBe(true);
    expect(plan.vfs.has("src/proxy.ts")).toBe(false);
    expect(manifestAt(plan.vfs, "package.json")).toMatchObject({
      scripts: { dev: "bun run --cwd apps/web next dev" },
      workspaces: ["apps/web"],
    });
    expect(manifestAt(plan.vfs, "apps/web/package.json")).toMatchObject({
      dependencies: { next: "catalog:" },
      devDependencies: { "babel-plugin-react-compiler": "catalog:" },
    });
  });

  test.each(["single", "monorepo"] as const)(
    "React Compiler is on and the layout imports the styles entry (%s)",
    async (layout) => {
      const { plan } = await build(layout);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(plan.vfs.read(`${directory}next.config.ts`))).toContain("reactCompiler: true");
      expect(String(plan.vfs.read(`${directory}src/app/layout.tsx`))).toContain(
        'import "../styles";',
      );
      expect(plan.vfs.has(`${directory}src/styles.ts`)).toBe(true);
    },
  );

  test.each(["single", "monorepo"] as const)(
    "tailwind4 registers its stylesheet in src/styles.ts (%s)",
    async (layout) => {
      const { plan } = await build(layout, ["next", "tailwind4"]);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(plan.vfs.read(`${directory}src/styles.ts`))).toContain(
        'import "./styles.css";',
      );
      expect(plan.vfs.has(`${directory}postcss.config.mjs`)).toBe(true);
    },
  );

  test("appends the agents Region and a .gitignore Region", async () => {
    const { plan } = await build("single");
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin next:agents");
    const ignore = String(plan.vfs.read(".gitignore"));
    expect(ignore).toContain("# aokit:begin next:next");
    expect(ignore).toContain(".next");
    expect(ignore).not.toContain("<!--");
  });

  test("ships a Skill with valid frontmatter", async () => {
    const { plan } = await build("single");
    expect(String(plan.vfs.read(".claude/skills/next/SKILL.md"))).toMatch(
      /^---\nname: next\ndescription: \S.*\n---\n/u,
    );
  });

  test("provides the web capabilities and declares the Extension points", () => {
    expect(next.provides.map((entry) => entry.capability)).toEqual([
      "web",
      "web:ssr",
      "web:react",
      "web:app-router",
    ]);
    expect(next.extensionPoints.map((point) => `${point.name}@${point.version}`)).toEqual([
      "web.providers@1.0.0",
      "web.styles@1.0.0",
      "next.config@1.0.0",
      "next.plugins@1.0.0",
    ]);
  });

  test("conflicts with another web base", async () => {
    const built = await buildSelection(["next", "vite-react"], "single");
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.error.message).toContain("next");
      expect(built.error.message).toContain("vite-react");
    }
  });
});
