import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
});

const selection = ["vite-react", "oxc", "eslint", "eslint-react"] as const;

async function build(layout: "single" | "monorepo") {
  const built = await buildSelection(selection, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built.plan.vfs;
}

describe("eslint-react", () => {
  test.each(["single", "monorepo"] as const)(
    "contributes its configs to eslint.config.mjs (%s)",
    async (layout) => {
      const config = String((await build(layout)).read("eslint.config.mjs"));
      expect(config).toContain("aokit:begin eslint-react:configs");
      expect(config).toContain("jsxA11y.flatConfigs.recommended");
      expect(config.indexOf("aokit:end eslint-react:configs")).toBeLessThan(
        config.indexOf("export default"),
      );
    },
  );

  test("places its dependencies at the root", async () => {
    const single = packageSchema.parse(
      JSON.parse(String((await build("single")).read("package.json"))),
    );
    expect(single.devDependencies).toMatchObject({
      "@eslint-react/eslint-plugin": "^5.28.8",
      "eslint-plugin-jsx-a11y": "^6.10.2",
      "eslint-plugin-react-hooks": "^7.1.1",
    });
    const monorepo = packageSchema.parse(
      JSON.parse(String((await build("monorepo")).read("package.json"))),
    );
    expect(monorepo.devDependencies).toMatchObject({
      "@eslint-react/eslint-plugin": "^5.28.8",
      "eslint-plugin-jsx-a11y": "^6.10.2",
      "eslint-plugin-react-hooks": "^7.1.1",
    });
  });

  test("appends the agents Region", async () => {
    const agents = String((await build("single")).read("AGENTS.md"));
    expect(agents).toContain("aokit:begin eslint-react:agents");
  });

  test("fails without a React base, naming web:react", async () => {
    const built = await buildSelection(["oxc", "eslint", "eslint-react"], "single");
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toContain("web:react");
  });
});
