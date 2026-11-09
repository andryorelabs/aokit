import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("base-ui", () => {
  test.each(["single", "monorepo"] as const)(
    "writes its starter file on vite-react (%s)",
    async (layout) => {
      const vfs = await build(layout, ["vite-react", "base-ui"]);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(vfs.read(`${directory}src/components/ui/button.tsx`))).toContain(
        "@base-ui/react/button",
      );
    },
  );

  test("places its dependencies per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single", ["vite-react", "base-ui"])).read("package.json"))),
    );
    expect(single.dependencies).toMatchObject({ "@base-ui/react": "^1.9.0" });
    const web = packageSchema.parse(
      JSON.parse(
        String((await build("monorepo", ["vite-react", "base-ui"])).read("apps/web/package.json")),
      ),
    );
    expect(web.dependencies).toMatchObject({ "@base-ui/react": "catalog:" });
  });

  test("appends the agents Region", async () => {
    const vfs = await build("single", ["vite-react", "base-ui"]);
    expect(String(vfs.read("AGENTS.md"))).toContain("aokit:begin base-ui:agents");
  });

  test("fails without a React base, naming the missing requirement", async () => {
    const built = await buildSelection(["base-ui"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web:react");
  });
});
