import { expect, test } from "bun:test";
import { z } from "zod";
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
