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

describe("tanstack-table", () => {
  test.each(["single", "monorepo"] as const)(
    "writes its starter file on vite-react (%s)",
    async (layout) => {
      const vfs = await build(layout, ["vite-react", "tanstack-table"]);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(vfs.read(`${directory}src/components/example-table.tsx`))).toContain(
        "@tanstack/react-table",
      );
    },
  );

  test("places its dependencies per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(
        String((await build("single", ["vite-react", "tanstack-table"])).read("package.json")),
      ),
    );
    expect(single.dependencies).toMatchObject({ "@tanstack/react-table": "^9.3.1" });
    const web = packageSchema.parse(
      JSON.parse(
        String(
          (await build("monorepo", ["vite-react", "tanstack-table"])).read("apps/web/package.json"),
        ),
      ),
    );
    expect(web.dependencies).toMatchObject({ "@tanstack/react-table": "catalog:" });
  });

  test("appends the agents Region", async () => {
    const vfs = await build("single", ["vite-react", "tanstack-table"]);
    expect(String(vfs.read("AGENTS.md"))).toContain("aokit:begin tanstack-table:agents");
  });

  test("fails without a React base, naming the missing requirement", async () => {
    const built = await buildSelection(["tanstack-table"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web:react");
  });
});
