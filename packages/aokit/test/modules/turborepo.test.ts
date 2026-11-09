import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[] = ["turborepo"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

describe("turborepo", () => {
  test.each(["single", "monorepo"] as const)(
    "writes turbo.json at the root (%s)",
    async (layout) => {
      const { plan } = await build(layout);
      expect(plan.vfs.paths()).toEqual([
        ".gitignore",
        "AGENTS.md",
        "CLAUDE.md",
        "package.json",
        "turbo.json",
      ]);
      const config = z
        .object({ tasks: z.record(z.string(), z.unknown()) })
        .parse(JSON.parse(String(plan.vfs.read("turbo.json"))));
      expect(Object.keys(config.tasks)).toContain("build");
    },
  );

  test("adds turbo to the root devDependencies and a task script", async () => {
    const root = packageSchema.parse(
      JSON.parse(String((await build("single")).plan.vfs.read("package.json"))),
    );
    expect(root.devDependencies).toEqual({ turbo: "^2.11.10" });
    expect(root.scripts).toEqual({ task: "turbo run" });
  });

  test.each(["single", "monorepo"] as const)(
    "declares the package manager Turborepo requires (%s)",
    async (layout) => {
      const { plan } = await build(layout);
      const root = z
        .object({ packageManager: z.string() })
        .parse(JSON.parse(String(plan.vfs.read("package.json"))));
      expect(root.packageManager).toStartWith("bun@");
    },
  );

  test("monorepo keeps turbo in the root devDependencies next to the workspace", async () => {
    const { plan } = await build("monorepo", ["turborepo", "tsdown"]);
    const root = packageSchema
      .extend({ workspaces: z.array(z.string()) })
      .parse(JSON.parse(String(plan.vfs.read("package.json"))));
    expect(root.devDependencies).toEqual({ turbo: "^2.11.10" });
    expect(root.workspaces).toEqual(["packages/lib"]);
    expect(String(plan.vfs.read("turbo.json"))).toContain('"tasks"');
  });

  test("appends the agents Region", async () => {
    const { plan, lockfile } = await build("single");
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin turborepo:agents");
    expect(lockfile.modules["turborepo"]?.version).toBe("1.0.0");
  });
});
