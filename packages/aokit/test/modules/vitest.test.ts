import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "vitest writes the config, smoke test and script (%s)",
  async (layout) => {
    const built = await buildSelection(["vitest"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    expect(String(vfs.read("vitest.config.ts"))).toContain("vitest/config");
    expect(String(vfs.read("tests/smoke.test.ts"))).toContain('from "vitest"');
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.scripts["test"]).toBe("vitest run");
    expect(manifest.devDependencies["vitest"]).toBe("^5.1.0");
  },
);

test("vitest appends its agents Region", async () => {
  const built = await buildSelection(["vitest"], "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## vitest");
});

test("vitest and bun-test together fail resolution naming both", async () => {
  const built = await buildSelection(["vitest", "bun-test"], "monorepo");
  expect(built.ok).toBe(false);
  if (!built.ok) {
    expect(built.error.message).toContain("bun-test");
    expect(built.error.message).toContain("vitest");
  }
});
