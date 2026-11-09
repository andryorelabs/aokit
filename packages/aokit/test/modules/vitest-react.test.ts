import { expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
});

const selection = ["vite-react", "vitest", "vitest-react"];
const dependencyNames = [
  "@vitest/browser-playwright",
  "happy-dom",
  "playwright",
  "vitest-browser-react",
];

function readPackage(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

test.each(["single", "monorepo"] as const)(
  "vitest-react writes the browser-mode config, sample tests and dependencies (%s)",
  async (layout) => {
    const built = await buildSelection(selection, layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    const webDirectory = layout === "single" ? "" : "apps/web/";
    const config = String(vfs.read(`${webDirectory}vitest.react.config.ts`));
    expect(config).toContain('environment: "happy-dom"');
    expect(config).toContain("enabled: true");
    expect(config).toContain("playwright()");
    expect(vfs.has(`${webDirectory}src/greeting.dom-test.tsx`)).toBe(true);
    expect(vfs.has(`${webDirectory}src/greeting.browser-test.tsx`)).toBe(true);
    const web = readPackage(vfs, `${webDirectory}package.json`);
    expect(web.scripts["test:react"]).toBe("vitest run -c vitest.react.config.ts");
    const expectedRange = layout === "single" ? undefined : "catalog:";
    for (const name of dependencyNames) {
      expect(web.devDependencies[name]).toBeDefined();
      if (expectedRange !== undefined) expect(web.devDependencies[name]).toBe(expectedRange);
    }
    const root = readPackage(vfs, "package.json");
    expect(root.scripts["test:coverage"]).toBe("vitest run --coverage");
    expect(root.devDependencies["@vitest/coverage-v8"]).toBeDefined();
    if (layout === "monorepo") {
      for (const name of dependencyNames) {
        expect(root.devDependencies[name]).toBeUndefined();
      }
    }
  },
);

test("vitest-react appends its agents Region", async () => {
  const built = await buildSelection(selection, "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(String(built.plan.vfs.read("AGENTS.md"))).toContain("## vitest-react");
});

test("vitest-react with bun-test fails resolution on test-runner", async () => {
  const built = await buildSelection(["vite-react", "bun-test", "vitest-react"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain("test-runner");
});

test("vitest-react without a web base fails resolution naming web:react", async () => {
  const built = await buildSelection(["vitest", "vitest-react"], "single");
  expect(built.ok).toBe(false);
  if (!built.ok) expect(built.error.message).toContain("web:react");
});
