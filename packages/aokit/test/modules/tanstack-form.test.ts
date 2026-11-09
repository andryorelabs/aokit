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

describe("tanstack-form", () => {
  test.each(["single", "monorepo"] as const)(
    "writes its starter file on vite-react (%s)",
    async (layout) => {
      const vfs = await build(layout, ["vite-react", "tanstack-form"]);
      const directory = layout === "single" ? "" : "apps/web/";
      expect(String(vfs.read(`${directory}src/lib/example-form.ts`))).toContain(
        "@tanstack/react-form",
      );
    },
  );

  test("places its dependencies per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(
        String((await build("single", ["vite-react", "tanstack-form"])).read("package.json")),
      ),
    );
    expect(single.dependencies).toMatchObject({
      "@tanstack/react-form": "^1.33.5",
      zod: "^4.6.7",
    });
    const web = packageSchema.parse(
      JSON.parse(
        String(
          (await build("monorepo", ["vite-react", "tanstack-form"])).read("apps/web/package.json"),
        ),
      ),
    );
    expect(web.dependencies).toMatchObject({ "@tanstack/react-form": "catalog:", zod: "catalog:" });
  });

  test("appends the agents Region", async () => {
    const vfs = await build("single", ["vite-react", "tanstack-form"]);
    expect(String(vfs.read("AGENTS.md"))).toContain("aokit:begin tanstack-form:agents");
  });

  test("fails without a React base, naming the missing requirement", async () => {
    const built = await buildSelection(["tanstack-form"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web:react");
  });
});
