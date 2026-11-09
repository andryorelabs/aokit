import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "playwright writes the config, smoke spec and script (%s)",
  async (layout) => {
    const built = await buildSelection(["vite-react", "playwright"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    expect(String(vfs.read("playwright.config.ts"))).toContain("testMatch");
    expect(String(vfs.read("e2e/smoke.e2e.ts"))).toContain("@playwright/test");
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.scripts["test:e2e"]).toBe("playwright test");
    expect(manifest.devDependencies["@playwright/test"]).toBe("^1.65.0");
  },
);

test("playwright appends its agents Region", async () => {
  const built = await buildSelection(["vite-react", "playwright"], "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## playwright");
});

test("playwright without a web base fails resolution", async () => {
  const built = await buildSelection(["playwright"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain("web");
});
