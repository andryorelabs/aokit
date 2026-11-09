import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

test.each(["single", "monorepo"] as const)(
  "axe adds the accessibility spec next to the Playwright suite (%s)",
  async (layout) => {
    const built = await buildSelection(["vite-react", "playwright", "axe"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    expect(String(vfs.read("e2e/a11y.e2e.ts"))).toContain("@axe-core/playwright");
    expect(String(vfs.read("e2e/smoke.e2e.ts"))).toContain("@playwright/test");
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.scripts["test:e2e"]).toBe("playwright test");
    expect(manifest.devDependencies["@axe-core/playwright"]).toBe("^4.14.0");
    expect(manifest.devDependencies["@playwright/test"]).toBe("^1.65.0");
  },
);

test("axe appends its agents Region", async () => {
  const built = await buildSelection(["vite-react", "playwright", "axe"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("## axe");
  expect(agents).toContain("## playwright");
});

test("axe without e2e fails resolution", async () => {
  const built = await buildSelection(["axe"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain("e2e");
});
