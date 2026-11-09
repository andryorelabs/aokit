import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "bun-test writes the smoke test and script (%s)",
  async (layout) => {
    const built = await buildSelection(["bun-test"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    expect(String(vfs.read("tests/smoke.test.ts"))).toContain('from "bun:test"');
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.scripts["test"]).toBe("bun test");
    expect(manifest.devDependencies["@types/bun"]).toBe("^1.4.4");
  },
);

test("bun-test appends its agents Region", async () => {
  const built = await buildSelection(["bun-test"], "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## bun-test");
});

test("bun-test and vitest together fail resolution naming both", async () => {
  const built = await buildSelection(["bun-test", "vitest"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) {
    expect(built.error.message).toContain("bun-test");
    expect(built.error.message).toContain("vitest");
  }
});
