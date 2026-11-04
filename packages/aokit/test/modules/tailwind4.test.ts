import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogSchema, parseManifest } from "@aokit/module";
import type { EngineModule } from "../../src/engine/index.ts";
import { type PipelineInput, buildProject } from "../../src/pipeline/index.ts";
import tailwind4 from "../../../../registry-src/tailwind4/module.ts";
import viteReact from "../../../../registry-src/vite-react/module.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "registry-src");
const catalog = catalogSchema.parse(
  JSON.parse(readFileSync(join(sourceRoot, "catalog", "2026.11.0.json"), "utf8")),
);

function curated(name: string, declared: object): EngineModule {
  return {
    manifest: parseManifest(declared),
    readFile: (from) => readFileSync(join(sourceRoot, name, from), "utf8"),
  };
}

const webBase: EngineModule = {
  manifest: parseManifest({
    name: "web-base",
    version: "1.0.0",
    provides: ["web"],
    files: [
      { from: "providers.tsx", to: "src/providers.tsx", target: "web" },
      { from: "vite.config.ts", to: "vite.config.ts", target: "web" },
    ],
    extensionPoints: [
      {
        name: "vite.plugins",
        version: "1.0.0",
        target: "web",
        kind: "array",
        anchor: "plugins",
        file: "vite.config.ts",
      },
      {
        name: "web.providers",
        version: "1.0.0",
        target: "web",
        kind: "array",
        anchor: "providers",
        file: "src/providers.tsx",
      },
    ],
  }),
  readFile: (from) =>
    from === "vite.config.ts" ? "export const plugins = [];\n" : "export const providers = [];\n",
};

function input(
  layout: "single" | "monorepo",
  selection: string[],
  available: EngineModule[],
): PipelineInput {
  return {
    selection,
    available,
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

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("tailwind4", () => {
  test("alone on a minimal web base writes the stylesheet, provider and deps", async () => {
    const built = await buildProject(
      input("single", ["tailwind4", "web-base"], [curated("tailwind4", tailwind4), webBase]),
    );
    if (!built.ok) throw new Error(built.error.message);
    expect(built.plan.vfs.paths()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      "src/providers.tsx",
      "src/styles.css",
      "src/tailwind-provider.tsx",
      "vite.config.ts",
    ]);
    expect(JSON.parse(String(built.plan.vfs.read("package.json")))).toMatchObject({
      dependencies: { tailwindcss: "^4.3.4" },
      devDependencies: { "@tailwindcss/vite": "^4.3.4" },
    });
  });

  test.each(["single", "monorepo"] as const)(
    "vite-react + tailwind4 registers the provider and CSS import once (%s)",
    async (layout) => {
      const built = await buildProject(
        input(
          layout,
          ["vite-react", "tailwind4"],
          [curated("vite-react", viteReact), curated("tailwind4", tailwind4)],
        ),
      );
      if (!built.ok) throw new Error(built.error.message);
      const directory = layout === "single" ? "" : "apps/web/";
      const providers = String(built.plan.vfs.read(`${directory}src/providers.tsx`));
      const styles = String(built.plan.vfs.read(`${directory}src/styles.css`));
      expect(occurrences(providers, 'from "./tailwind-provider"')).toBe(1);
      expect(occurrences(providers, "TailwindProvider")).toBe(2);
      expect(occurrences(styles, '@import "tailwindcss";')).toBe(1);
      const viteConfig = String(built.plan.vfs.read(`${directory}vite.config.ts`));
      expect(occurrences(viteConfig, 'from "@tailwindcss/vite"')).toBe(1);
      expect(occurrences(viteConfig, "tailwindcss()")).toBe(1);
    },
  );

  test("declares styles.theme as a region point and requires web providers", () => {
    const manifest = parseManifest(tailwind4);
    expect(manifest.requires).toEqual(["web", "ext:web.providers@^1", "ext:vite.plugins@^1"]);
    expect(manifest.extensionPoints).toEqual([
      {
        name: "styles.theme",
        version: "1.0.0",
        target: "web",
        kind: "region",
        anchor: "theme",
        file: "src/styles.css",
      },
    ]);
  });
});
