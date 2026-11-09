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

describe("tanstack-virtual", () => {
  test.each(["single", "monorepo"] as const)(
    "writes its starter file on vite-react (%s)",
    async (layout) => {
      const vfs = await build(layout, ["vite-react", "tanstack-virtual"]);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(vfs.read(`${directory}src/lib/virtualized-list.ts`))).toContain(
        "@tanstack/react-virtual",
      );
    },
  );

  test("places its dependencies per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(
        String((await build("single", ["vite-react", "tanstack-virtual"])).read("package.json")),
      ),
    );
    expect(single.dependencies).toMatchObject({ "@tanstack/react-virtual": "^3.14.26" });
    const web = packageSchema.parse(
      JSON.parse(
        String(
          (await build("monorepo", ["vite-react", "tanstack-virtual"])).read(
            "apps/web/package.json",
          ),
        ),
      ),
    );
    expect(web.dependencies).toMatchObject({ "@tanstack/react-virtual": "catalog:" });
  });

  test("appends the agents Region", async () => {
    const vfs = await build("single", ["vite-react", "tanstack-virtual"]);
    expect(String(vfs.read("AGENTS.md"))).toContain("aokit:begin tanstack-virtual:agents");
  });

  test("fails without a React base, naming the missing requirement", async () => {
    const built = await buildSelection(["tanstack-virtual"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web:react");
  });
});
