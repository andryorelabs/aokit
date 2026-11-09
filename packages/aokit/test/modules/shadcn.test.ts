import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const componentsSchema = z.object({ aliases: z.record(z.string(), z.string()) });

const selection = ["vite-react", "tailwind4", "base-ui", "shadcn"];

async function build(layout: "single" | "monorepo", names: readonly string[] = selection) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("shadcn", () => {
  test("writes components.json aliases that match the shared-ui Target (single)", async () => {
    const vfs = await build("single");
    const config = componentsSchema.parse(JSON.parse(String(vfs.read("components.json"))));
    expect(config.aliases).toMatchObject({
      ui: "./src/components/ui",
      lib: "./src/components/lib",
      utils: "./src/components/lib/utils",
    });
    expect(String(vfs.read("src/components/lib/utils.ts"))).toContain("twMerge");
    expect(String(vfs.read("src/components/ui/sonner.tsx"))).toContain("sonner");
  });

  test("writes components.json aliases that match the shared-ui Target (monorepo)", async () => {
    const vfs = await build("monorepo");
    const config = componentsSchema.parse(JSON.parse(String(vfs.read("apps/web/components.json"))));
    expect(config.aliases).toMatchObject({
      ui: "../../packages/ui/ui",
      utils: "../../packages/ui/lib/utils",
    });
    expect(vfs.paths()).toContain("packages/ui/lib/utils.ts");
  });

  test("contributes theme tokens and the animation import to the stylesheet", async () => {
    const css = String((await build("single")).read("src/styles.css"));
    expect(css).toContain("tw-animate-css");
    expect(css).toContain("--background");
    expect(css).toContain("--color-primary");
  });

  test("places its dependencies per Target", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(single.dependencies).toMatchObject({ clsx: "^2.1.1", sonner: "^2.0.8" });
    expect(single.devDependencies).toMatchObject({ "tw-animate-css": "^1.4.0" });
    const ui = packageSchema.parse(
      JSON.parse(String((await build("monorepo")).read("packages/ui/package.json"))),
    );
    expect(ui.dependencies).toMatchObject({ clsx: "catalog:", sonner: "catalog:" });
  });

  test("ships its skill and appends the agents Region", async () => {
    const vfs = await build("single");
    expect(String(vfs.read(".claude/skills/shadcn/SKILL.md"))).toContain("name: shadcn");
    expect(String(vfs.read("AGENTS.md"))).toContain("aokit:begin shadcn:agents");
  });

  test.each([
    [["vite-react", "tailwind4", "shadcn"], "ui:primitives"],
    [["vite-react", "base-ui", "shadcn"], "styles.theme"],
    [["base-ui", "tailwind4", "shadcn"], "web:react"],
  ])("fails without %p, naming the missing requirement", async (names, missing) => {
    const built = await buildSelection(names, "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain(missing);
  });
});
