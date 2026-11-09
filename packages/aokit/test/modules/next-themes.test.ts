import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const base = ["next", "next-themes"] as const;

async function build(layout: "single" | "monorepo", names: readonly string[] = base) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("next-themes", () => {
  test.each(["single", "monorepo"] as const)(
    "writes the theme provider and registers it in providers (%s)",
    async (layout) => {
      const vfs = await build(layout);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(vfs.read(`${directory}src/theme/provider.tsx`))).toContain(
        "NextThemesProvider",
      );
      const providers = String(vfs.read(`${directory}src/providers.tsx`));
      expect(providers).toContain("ThemeProvider");
      expect(providers).toContain("./theme/provider");
    },
  );

  test("places its dependency per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(single.dependencies).toMatchObject({ "next-themes": "^0.4.6" });
    const web = packageSchema.parse(
      JSON.parse(String((await build("monorepo")).read("apps/web/package.json"))),
    );
    expect(web.dependencies).toMatchObject({ "next-themes": "catalog:" });
  });

  test("appends the agents Region", async () => {
    expect(String((await build("single")).read("AGENTS.md"))).toContain(
      "aokit:begin next-themes:agents",
    );
  });

  test("fails without a Next base, naming the missing requirement", async () => {
    const built = await buildSelection(["next-themes"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web.providers");
  });

  test("fails on a base without the App Router", async () => {
    const built = await buildSelection(["vite-react", "next-themes"], "single");
    expect(built.ok).toBe(false);
  });
});
