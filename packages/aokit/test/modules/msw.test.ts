import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).default({}),
});

test.each(["single", "monorepo"] as const)(
  "msw writes the handler, server and setup file and adds msw (%s)",
  async (layout) => {
    const built = await buildSelection(["vitest", "msw"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    expect(String(vfs.read("src/mocks/handlers.ts"))).toContain("/api/hello");
    expect(String(vfs.read("src/mocks/server.ts"))).toContain("setupServer");
    expect(String(vfs.read("src/mocks/vitest.setup.ts"))).toContain("server.listen");
    const manifest = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
    expect(manifest.devDependencies["msw"]).toBeDefined();
  },
);

test("msw appends its agents Region", async () => {
  const built = await buildSelection(["msw"], "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## msw");
});
