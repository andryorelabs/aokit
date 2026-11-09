import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseManifest } from "@aokit/module";
import nuqsNextSource from "../../../../registry-src/nuqs-next/module.ts";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const nuqsNext = parseManifest(nuqsNextSource);
const names = ["next", "nuqs-next"] as const;

async function build(layout: "single" | "monorepo", selection: readonly string[] = names) {
  const built = await buildSelection(selection, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("nuqs-next", () => {
  test.each([
    ["single", ""],
    ["monorepo", "apps/web/"],
  ] as const)("registers the Next adapter in the providers (%s)", async (layout, directory) => {
    const providers = String((await build(layout)).read(`${directory}src/providers.tsx`));
    expect(providers).toContain('from "nuqs/adapters/next/app"');
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
      "aokit:begin nuqs-next:agents",
    );
  });

  test("provides url-state and requires web:app-router", () => {
    expect(nuqsNext.provides.map((entry) => entry.capability)).toEqual(["url-state"]);
    expect(nuqsNext.requires).toContain("web:app-router");
  });

  test("fails without a Next base", async () => {
    const built = await buildSelection(["nuqs-next"], "single");
    expect(built.ok).toBe(false);
  });

  test("fails on a SPA base naming web:app-router", async () => {
    const built = await buildSelection(["vite-react", "nuqs-next"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web:app-router");
  });

  test("selecting nuqs-next with nuqs-vite fails naming both", async () => {
    const built = await buildSelection(["next", "nuqs-next", "nuqs-vite"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("nuqs-next");
    expect(built.error.message).toContain("nuqs-vite");
  });
});
