import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "commitlint writes the commit-msg hook and config (%s)",
  async (layout) => {
    const built = await buildSelection(["husky", "commitlint"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    expect(String(vfs.read(".husky/commit-msg"))).toContain("commitlint --edit");
    expect(String(vfs.read("commitlint.config.mjs"))).toContain("config-conventional");
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.devDependencies["@commitlint/cli"]).toBe("^21.2.4");
    expect(manifest.devDependencies["@commitlint/config-conventional"]).toBe("^21.2.4");
    expect(manifest.scripts["prepare"]).toBe("husky");
  },
);

test("commitlint appends its agents Region", async () => {
  const built = await buildSelection(["husky", "commitlint"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("## commitlint");
  expect(agents).toContain("## husky");
});

test("commitlint without git-hooks fails resolution", async () => {
  const built = await buildSelection(["commitlint"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain("git-hooks");
});
