import { expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import eslint from "../../../../registry-src/eslint/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

const lintConfigSchema = z.object({ ignorePatterns: z.array(z.string()) });

test.each([
  ["single", ".oxlintrc.json"],
  ["monorepo", "packages/config/.oxlintrc.json"],
] as const)(
  "eslint next to oxc writes its config, script and ignores (%s)",
  async (layout, oxlintrc) => {
    const built = await buildSelection(["oxc", "eslint"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const manifest = packageSchema.parse(JSON.parse(String(built.plan.vfs.read("package.json"))));
    expect(manifest.scripts["lint:eslint"]).toBe("eslint .");
    expect(manifest.scripts["lint"]).toContain("oxlint");
    expect(manifest.devDependencies["eslint"]).toBe("^10.14.0");
    expect(manifest.devDependencies["typescript-eslint"]).toBe("^8.72.1");
    expect(manifest.devDependencies["eslint-plugin-astro"]).toBe("^3.2.1");
    expect(built.plan.vfs.has("eslint.config.mjs")).toBe(true);
    const config = lintConfigSchema.parse(JSON.parse(String(built.plan.vfs.read(oxlintrc))));
    expect(config.ignorePatterns).toContain(".astro/**");
    expect(config.ignorePatterns).toContain("dist/**");
  },
);

test("eslint appends its agents Region", async () => {
  const built = await buildSelection(["oxc", "eslint"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("aokit:begin eslint:agents");
  expect(agents).toContain("## eslint");
});

test("selecting eslint without a lint provider fails resolution", async () => {
  const built = await buildSelection(["eslint"], "single");
  expect(built.ok).toBe(false);
});

test.each(["single", "monorepo"] as const)(
  "eslint adds unicorn, jsdoc and eslint-comments to its config and deps (%s)",
  async (layout) => {
    const built = await buildSelection(["oxc", "eslint"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const manifest = packageSchema.parse(JSON.parse(String(built.plan.vfs.read("package.json"))));
    expect(manifest.devDependencies).toMatchObject({
      "eslint-plugin-unicorn": "^79.0.0",
      "eslint-plugin-jsdoc": "^65.4.5",
      "@eslint-community/eslint-plugin-eslint-comments": "^4.8.1",
    });
    const config = String(built.plan.vfs.read("eslint.config.mjs"));
    expect(config).toContain("unicorn.configs.recommended");
    expect(config).toContain('jsdoc.configs["flat/recommended-typescript"]');
    expect(config).toContain("eslintComments.recommended");
    expect(config).toContain("aokit:begin eslint:configs");
  },
);

test("eslint declares the eslint.configs region Extension point", () => {
  expect(parseManifest(eslint).extensionPoints).toEqual([
    {
      name: "eslint.configs",
      version: "1.0.0",
      target: "root",
      kind: "region",
      anchor: "configs",
      file: "eslint.config.mjs",
    },
  ]);
});
