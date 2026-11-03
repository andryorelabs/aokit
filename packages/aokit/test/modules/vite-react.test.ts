import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogSchema, parseManifest } from "@aokit/module";
import type { EngineModule } from "../../src/engine/index.ts";
import { type PipelineInput, buildProject } from "../../src/pipeline/index.ts";
import viteReact from "../../../../registry-src/vite-react/module.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "registry-src");
const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(sourceRoot, "catalog", "2026.11.0.json"), "utf8")),
);

const curated: EngineModule = {
  manifest: parseManifest(viteReact),
  readFile: (from) => readFileSync(join(sourceRoot, "vite-react", from), "utf8"),
};

function input(layout: "single" | "monorepo"): PipelineInput {
  return {
    selection: ["vite-react"],
    available: [curated],
    answers: {},
    layout,
    catalog,
    context: { now: new Date(0), random: () => 0.5, env: {} },
    registry: {
      name: "fixture",
      source: "https://registry.example/fixture",
      release: "2026.11.0",
      minCliVersion: "0.0.0",
    },
  };
}

describe("vite-react", () => {
  test("single writes the web base with scripts and dependencies", async () => {
    const built = await buildProject(input("single"));
    if (!built.ok) throw new Error(built.error.message);
    expect(built.plan.vfs.paths()).toEqual([
      "index.html",
      "package.json",
      "src/main.tsx",
      "src/providers.tsx",
      "src/router.tsx",
      "tsconfig.json",
      "vite.config.ts",
    ]);
    expect(JSON.parse(String(built.plan.vfs.read("package.json")))).toMatchObject({
      scripts: {
        build: "bun run --cwd . vite build",
        dev: "bun run --cwd . vite",
        preview: "bun run --cwd . vite preview",
      },
      dependencies: { react: "^19.3.1", "react-dom": "^19.3.1" },
      devDependencies: {
        "@types/react": "^19.3.0",
        "@types/react-dom": "^19.3.0",
        "@vitejs/plugin-react": "^6.2.1",
        typescript: "^7.0.2",
        vite: "^8.3.5",
      },
    });
  });

  test("monorepo puts the Extension point files in the web package", async () => {
    const built = await buildProject(input("monorepo"));
    if (!built.ok) throw new Error(built.error.message);
    expect(built.plan.vfs.paths()).toEqual([
      "apps/web/index.html",
      "apps/web/package.json",
      "apps/web/src/main.tsx",
      "apps/web/src/providers.tsx",
      "apps/web/src/router.tsx",
      "apps/web/tsconfig.json",
      "apps/web/vite.config.ts",
      "package.json",
    ]);
    expect(JSON.parse(String(built.plan.vfs.read("package.json")))).toMatchObject({
      scripts: { dev: "bun run --cwd apps/web vite" },
      workspaces: ["apps/web"],
    });
  });

  test.each(["single", "monorepo"] as const)(
    "index.html entry resolves to a file next to vite.config.ts (%s)",
    async (layout) => {
      const built = await buildProject(input(layout));
      if (!built.ok) throw new Error(built.error.message);
      const directory = layout === "single" ? "" : "apps/web/";
      const html = String(built.plan.vfs.read(`${directory}index.html`));
      const entry = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
      expect(entry).toBeDefined();
      expect(built.plan.vfs.has(`${directory}${String(entry).replace(/^\//, "")}`)).toBe(true);
      expect(built.plan.vfs.has(`${directory}vite.config.ts`)).toBe(true);
    },
  );

  test("provides web and web:spa and declares both array points", () => {
    expect(curated.manifest.provides.map((entry) => entry.capability)).toEqual(["web", "web:spa"]);
    expect(
      curated.manifest.extensionPoints.map((point) => `${point.name}@${point.version}`),
    ).toEqual(["vite.plugins@1.0.0", "web.providers@1.0.0", "web.routes@1.0.0"]);
  });
});
