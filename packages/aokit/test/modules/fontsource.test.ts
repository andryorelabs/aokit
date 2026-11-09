import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

const stylesFile = {
  next: "src/styles.ts",
  "vite-react": "src/main.tsx",
  astro: "src/styles.ts",
} as const;

async function build(layout: "single" | "monorepo", names: readonly string[]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("fontsource", () => {
  test.each(["next", "vite-react", "astro"] as const)(
    "imports both fonts for side effects on %s",
    async (framework) => {
      const vfs = await build("single", [framework, "fontsource"]);
      const styles = String(vfs.read(stylesFile[framework]));
      expect(styles).toContain('import "@fontsource-variable/geist";');
      expect(styles).toContain('import "@fontsource-variable/geist-mono";');
    },
  );

  test("renders in a monorepo", async () => {
    const vfs = await build("monorepo", ["next", "fontsource"]);
    expect(String(vfs.read("apps/web/src/styles.ts"))).toContain("@fontsource-variable/geist");
  });

  test("places its dependencies per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single", ["next", "fontsource"])).read("package.json"))),
    );
    expect(single.dependencies).toMatchObject({
      "@fontsource-variable/geist": "^5.3.0",
      "@fontsource-variable/geist-mono": "^5.3.0",
    });
    const web = packageSchema.parse(
      JSON.parse(
        String((await build("monorepo", ["next", "fontsource"])).read("apps/web/package.json")),
      ),
    );
    expect(web.dependencies).toMatchObject({
      "@fontsource-variable/geist": "catalog:",
      "@fontsource-variable/geist-mono": "catalog:",
    });
  });

  test("appends the agents Region", async () => {
    expect(String((await build("single", ["next", "fontsource"])).read("AGENTS.md"))).toContain(
      "aokit:begin fontsource:agents",
    );
  });

  test("fails without a web.styles base", async () => {
    const built = await buildSelection(["fontsource"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web.styles");
  });
});
