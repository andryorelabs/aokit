import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "dotenvx writes the encrypt script, .env.example and the .env.keys Region (%s)",
  async (layout) => {
    const built = await buildSelection(["dotenvx"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const manifest = packageSchema.parse(JSON.parse(String(built.plan.vfs.read("package.json"))));
    expect(manifest.scripts["env:encrypt"]).toBe("dotenvx encrypt");
    expect(manifest.devDependencies["@dotenvx/dotenvx"]).toBe("^2.38.2");
    expect(built.plan.vfs.has(".env.example")).toBe(true);
    const gitignore = String(built.plan.vfs.read(".gitignore"));
    expect(gitignore).toContain("# aokit:begin dotenvx:keys");
    expect(gitignore).toContain(".env.keys");
    expect(gitignore).not.toContain("<!--");
  },
);

test("dotenvx appends its agents Region", async () => {
  const built = await buildSelection(["dotenvx"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("aokit:begin dotenvx:agents");
  expect(agents).toContain("## dotenvx");
});

test("dotenvx and t3-env are independent", async () => {
  const built = await buildSelection(["dotenvx", "t3-env"], "single");
  expect(built.ok).toBe(true);
});
