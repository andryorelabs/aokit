import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

const configPaths = {
  single: ".oxlintrc.shadcn.json",
  monorepo: "packages/config/.oxlintrc.shadcn.json",
} as const;

const selection = ["vite-react", "tailwind4", "base-ui", "shadcn", "oxc", "shadcn-lint"] as const;

async function build(layout: "single" | "monorepo") {
  const built = await buildSelection(selection, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("shadcn-lint", () => {
  test.each(["single", "monorepo"] as const)("ships its Oxlint config (%s)", async (layout) => {
    const vfs = await build(layout);
    const config = String(vfs.read(configPaths[layout]));
    expect(config).toContain('"jsPlugins"');
    expect(config).toContain("@shadcn/lint");
    expect(config).toContain("shadcn/no-raw-colors");
    expect(config).toContain("shadcn/no-arbitrary-values");
    expect(config).toContain("shadcn/no-inline-styles");
  });

  test.each(["single", "monorepo"] as const)(
    "adds the lint:shadcn script and the root devDependency (%s)",
    async (layout) => {
      const vfs = await build(layout);
      const pkg = packageSchema.parse(JSON.parse(String(vfs.read("package.json"))));
      expect(pkg.scripts?.["lint:shadcn"]).toBe(
        `oxlint -c ${layout === "single" ? "./" : ""}${configPaths[layout]}`,
      );
      expect(pkg.devDependencies).toMatchObject({ "@shadcn/lint": "^0.2.5" });
    },
  );

  test("appends the agents Region", async () => {
    const agents = String((await build("single")).read("AGENTS.md"));
    expect(agents).toContain("aokit:begin shadcn-lint:agents");
  });

  test("fails without shadcn, naming ui:components", async () => {
    const built = await buildSelection(
      ["vite-react", "tailwind4", "base-ui", "oxc", "shadcn-lint"],
      "single",
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("ui:components");
  });

  test("fails without oxc, naming lint", async () => {
    const built = await buildSelection(
      ["vite-react", "tailwind4", "base-ui", "shadcn", "shadcn-lint"],
      "single",
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("lint");
  });
});
