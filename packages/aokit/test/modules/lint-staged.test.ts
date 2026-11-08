import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "lint-staged writes the pre-commit hook and config (%s)",
  async (layout) => {
    const built = await buildSelection(["oxc", "husky", "lint-staged"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    expect(String(vfs.read(".husky/pre-commit"))).toContain("lint-staged");
    expect(JSON.parse(String(vfs.read(".lintstagedrc.json")))).toHaveProperty("*");
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.devDependencies["lint-staged"]).toBe("^17.6.0");
  },
);

test("lint-staged appends its agents Region", async () => {
  const built = await buildSelection(["oxc", "husky", "lint-staged"], "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## lint-staged");
});

test("lint-staged without git-hooks fails resolution", async () => {
  const built = await buildSelection(["oxc", "lint-staged"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain("git-hooks");
});

test("lint-staged without lint and format fails resolution", async () => {
  const built = await buildSelection(["husky", "lint-staged"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain("lint");
});

test("commitlint and lint-staged share husky without owning each other's hook", async () => {
  const built = await buildSelection(["oxc", "husky", "commitlint", "lint-staged"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const paths = built.plan.vfs.paths();
  expect(paths).toContain(".husky/commit-msg");
  expect(paths).toContain(".husky/pre-commit");
});
