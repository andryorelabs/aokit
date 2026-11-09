import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import nuqsViteSource from "../../../../registry-src/nuqs-vite/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const nuqsVite = parseManifest(nuqsViteSource);
const names = ["vite-react", "nuqs-vite"] as const;

async function build(layout: "single" | "monorepo", selection: readonly string[] = names) {
  const built = await buildSelection(selection, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("nuqs-vite", () => {
  test.each([
    ["single", ""],
    ["monorepo", "apps/web/"],
  ] as const)("registers the React adapter in the providers (%s)", async (layout, directory) => {
    const providers = String((await build(layout)).read(`${directory}src/providers.tsx`));
    expect(providers).toContain('from "nuqs/adapters/react"');
    expect(providers).toContain("NuqsAdapter");
  });

  test("places nuqs per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(single.dependencies).toMatchObject({ nuqs: "^2.10.2" });
    const web = packageSchema.parse(
      JSON.parse(String((await build("monorepo")).read("apps/web/package.json"))),
    );
    expect(web.dependencies).toMatchObject({ nuqs: "catalog:" });
  });

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin nuqs-vite:agents",
    );
  });

  test("provides url-state and requires web:spa", () => {
    expect(nuqsVite.provides.map((entry) => entry.capability)).toEqual(["url-state"]);
    expect(nuqsVite.requires).toContain("web:spa");
  });

  test("fails without a SPA base", async () => {
    const built = await buildSelection(["nuqs-vite"], "single");
    expect(built.ok).toBe(false);
  });

  test("fails on a Next base naming web:spa", async () => {
    const built = await buildSelection(["next", "nuqs-vite"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web:spa");
  });
});
