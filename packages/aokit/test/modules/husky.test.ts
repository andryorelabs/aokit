import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "husky writes the prepare script and its dependency (%s)",
  async (layout) => {
    const built = await buildSelection(["husky"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const manifest = packageSchema.parse(JSON.parse(String(built.plan.vfs.read("package.json"))));
    expect(manifest.scripts["prepare"]).toBe("husky");
    expect(manifest.devDependencies["husky"]).toBe("^9.1.7");
    expect(built.plan.vfs.paths().some((path) => path.startsWith(".husky/"))).toBe(false);
  },
);

test("husky appends its agents Region", async () => {
  const built = await buildSelection(["husky"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("aokit:begin husky:agents");
  expect(agents).toContain("## husky");
});
