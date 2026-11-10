import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import viteReactSource from "../../../../registry-src/vite-react/module.ts";
import { buildSelection } from "./support/index.ts";

const viteReact = parseManifest(viteReactSource);

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z.array(z.string()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[] = ["vite-react"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

function manifestAt(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

describe("vite-react", () => {
  test("single writes the web base with scripts, dependencies and the Compiler", async () => {
    const { plan } = await build("single");
    expect(plan.vfs.paths()).toEqual([
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "index.html",
      "package.json",
      "src/main.tsx",
      "src/providers.tsx",
      "src/router.tsx",
      "tsconfig.json",
      "vite.config.ts",
    ]);
    const manifest = manifestAt(plan.vfs, "package.json");
    expect(manifest.scripts).toMatchObject({
      build: "bun run --cwd . vite build",
      dev: "bun run --cwd . vite",
      preview: "bun run --cwd . vite preview",
      typecheck: "bun run --cwd . tsc --noEmit",
    });
    expect(manifest.dependencies).toEqual({ react: "^19.3.1", "react-dom": "^19.3.1" });
    expect(manifest.devDependencies).toMatchObject({
      "@babel/core": "^7.29.0",
      "@rolldown/plugin-babel": "^0.3.0",
      "@vitejs/plugin-react": "^6.2.1",
      "babel-plugin-react-compiler": "^1.0.0",
      vite: "^8.3.5",
    });
  });

  test("monorepo puts the web files and dependencies in the web package", async () => {
    const { plan } = await build("monorepo");
    expect(plan.vfs.paths()).toEqual([
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "apps/web/index.html",
      "apps/web/package.json",
      "apps/web/src/main.tsx",
      "apps/web/src/providers.tsx",
      "apps/web/src/router.tsx",
      "apps/web/tsconfig.json",
      "apps/web/vite.config.ts",
      "package.json",
    ]);
    expect(manifestAt(plan.vfs, "package.json")).toMatchObject({
      scripts: { dev: "bun run --cwd apps/web vite" },
      workspaces: ["apps/web"],
    });
    expect(manifestAt(plan.vfs, "apps/web/package.json").devDependencies).toMatchObject({
      "@rolldown/plugin-babel": "catalog:",
      "babel-plugin-react-compiler": "catalog:",
    });
  });

  test.each(["single", "monorepo"] as const)(
    "React Compiler is on in vite.config.ts and the entry resolves (%s)",
    async (layout) => {
      const { plan } = await build(layout);
      const directory = layout === "single" ? "" : "apps/web/";
      const config = String(plan.vfs.read(`${directory}vite.config.ts`));
      expect(config).toContain('from "@rolldown/plugin-babel"');
      expect(config).toContain("reactCompilerPreset()");
      const html = String(plan.vfs.read(`${directory}index.html`));
      const entry = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
      expect(entry).toBeDefined();
      expect(plan.vfs.has(`${directory}${String(entry).replace(/^\//, "")}`)).toBe(true);
    },
  );

  test("appends the agents Region and a .gitignore Region", async () => {
    const { plan } = await build("single");
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin vite-react:agents");
    const ignore = String(plan.vfs.read(".gitignore"));
    expect(ignore).toContain("# aokit:begin vite-react:vite-react");
    expect(ignore).toContain("node_modules");
    expect(ignore).not.toContain("<!--");
  });

  test("provides web, web:spa, web:react and web:static and declares the Extension points", () => {
    expect(viteReact.version).toBe("1.4.0");
    expect(viteReact.provides.map((entry) => entry.capability)).toEqual([
      "web",
      "web:spa",
      "web:react",
      "web:static",
    ]);
    expect(viteReact.extensionPoints.map((point) => `${point.name}@${point.version}`)).toEqual([
      "vite.plugins@1.0.0",
      "web.styles@1.0.0",
      "web.providers@1.0.0",
      "web.routes@1.0.0",
    ]);
  });
});
