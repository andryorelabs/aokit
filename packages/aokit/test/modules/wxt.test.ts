import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import wxtSource from "../../../../registry-src/wxt/module.ts";
import { buildSelection } from "./support/index.ts";

const wxt = parseManifest(wxtSource);

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z.array(z.string()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[] = ["wxt"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

function manifestAt(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

describe("wxt", () => {
  test("single writes the extension under extension/ with root scripts and dependencies", async () => {
    const { plan } = await build("single");
    expect(plan.vfs.paths()).toEqual([
      ".claude/skills/wxt/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "extension/entrypoints/background.ts",
      "extension/entrypoints/popup/App.tsx",
      "extension/entrypoints/popup/index.html",
      "extension/entrypoints/popup/main.tsx",
      "extension/tsconfig.json",
      "extension/wxt.config.ts",
      "package.json",
    ]);
    const manifest = manifestAt(plan.vfs, "package.json");
    expect(manifest.scripts).toMatchObject({
      "ext:build": "bun run --cwd extension wxt build",
      "ext:dev": "bun run --cwd extension wxt",
      "ext:zip": "bun run --cwd extension wxt zip",
    });
    expect(manifest.dependencies).toMatchObject({
      "@wxt-dev/module-react": "^1.2.2",
      react: "^19.3.1",
      wxt: "^0.21.5",
    });
  });

  test("monorepo puts the extension files and dependencies in apps/extension", async () => {
    const { plan } = await build("monorepo");
    expect(plan.vfs.paths()).toEqual([
      ".claude/skills/wxt/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "apps/extension/entrypoints/background.ts",
      "apps/extension/entrypoints/popup/App.tsx",
      "apps/extension/entrypoints/popup/index.html",
      "apps/extension/entrypoints/popup/main.tsx",
      "apps/extension/package.json",
      "apps/extension/tsconfig.json",
      "apps/extension/wxt.config.ts",
      "package.json",
    ]);
    expect(manifestAt(plan.vfs, "package.json")).toMatchObject({
      scripts: { "ext:build": "bun run --cwd apps/extension wxt build" },
      workspaces: ["apps/extension"],
    });
    expect(manifestAt(plan.vfs, "apps/extension/package.json").dependencies).toMatchObject({
      "@wxt-dev/module-react": "catalog:",
      wxt: "catalog:",
    });
  });

  test.each(["single", "monorepo"] as const)(
    "coexists with next without script or tsconfig collisions (%s)",
    async (layout) => {
      const { plan } = await build(layout, ["wxt", "next"]);
      const webDirectory = layout === "single" ? "" : "apps/web/";
      const extensionDirectory = layout === "single" ? "extension/" : "apps/extension/";
      expect(plan.vfs.has(`${webDirectory}tsconfig.json`)).toBe(true);
      expect(plan.vfs.has(`${extensionDirectory}tsconfig.json`)).toBe(true);
      const scripts = manifestAt(plan.vfs, "package.json").scripts ?? {};
      expect(scripts["dev"]).toContain("next dev");
      expect(scripts["build"]).toContain("next build");
      expect(scripts["ext:build"]).toContain("wxt build");
      const ignore = String(plan.vfs.read(".gitignore"));
      expect(ignore).toContain("# aokit:begin wxt:wxt");
      expect(ignore).toContain("# aokit:begin next:next");
    },
  );

  test("appends the agents Region", async () => {
    const { plan, lockfile } = await build("single");
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin wxt:agents");
    expect(lockfile.modules["wxt"]?.version).toBe("1.0.0");
  });

  test("coexists with a vite-react web base", async () => {
    const built = await buildSelection(["wxt", "vite-react"], "single");
    expect(built.ok).toBe(true);
  });

  test("provides only the extension capability", () => {
    expect(wxt.provides.map((entry) => entry.capability)).toEqual(["extension"]);
  });
});
