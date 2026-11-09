import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildSelection } from "./support/index.ts";

const packageSchema = z.object({
  type: z.string().optional(),
  files: z.array(z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  exports: z.record(z.string(), z.unknown()).optional(),
});

async function build(layout: "single" | "monorepo", names: readonly string[] = ["tsdown"]) {
  const built = await buildSelection(names, layout);
  if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
  return built;
}

function readPackage(vfs: { read(path: string): string | Uint8Array | undefined }, path: string) {
  return packageSchema.parse(JSON.parse(String(vfs.read(path))));
}

describe("tsdown", () => {
  test("single writes the library base at the root", async () => {
    const { plan } = await build("single");
    expect(plan.vfs.paths()).toEqual([
      ".claude/skills/tsdown-library/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      "src/cli.ts",
      "src/index.ts",
      "tsconfig.lib.json",
      "tsdown.config.ts",
    ]);
    expect(String(plan.vfs.read("tsdown.config.ts"))).toContain('entry: ["src/index.ts"]');
  });

  test("monorepo writes the library package", async () => {
    const { plan } = await build("monorepo");
    expect(plan.vfs.paths()).toEqual([
      ".claude/skills/tsdown-library/SKILL.md",
      ".gitignore",
      "AGENTS.md",
      "CLAUDE.md",
      "package.json",
      "packages/lib/package.json",
      "packages/lib/src/cli.ts",
      "packages/lib/src/index.ts",
      "packages/lib/tsconfig.lib.json",
      "packages/lib/tsdown.config.ts",
    ]);
  });

  test("places its devDependencies per Target", async () => {
    const single = readPackage((await build("single")).plan.vfs, "package.json");
    expect(single.devDependencies).toEqual({
      "@arethetypeswrong/cli": "^0.18.5",
      "@types/bun": "^1.4.4",
      publint: "^0.3.25",
      tsdown: "^0.23.7",
    });
    const lib = readPackage((await build("monorepo")).plan.vfs, "packages/lib/package.json");
    expect(lib.devDependencies).toEqual({
      "@arethetypeswrong/cli": "catalog:",
      "@types/bun": "catalog:",
      publint: "catalog:",
      tsdown: "catalog:",
    });
  });

  test("declares the published surface on the library package", async () => {
    const lib = readPackage((await build("monorepo")).plan.vfs, "packages/lib/package.json");
    expect(lib.type).toBe("module");
    expect(lib.files).toEqual(["dist"]);
    expect(Object.keys(lib.exports ?? {})).toEqual([".", "./package.json"]);
  });

  test.each([
    [
      "single",
      {
        "build:lib": "bun run --cwd . tsdown",
        compile: "bun build --compile ./src/cli.ts --outfile ./dist/cli",
      },
    ],
    [
      "monorepo",
      {
        "build:lib": "bun run --cwd packages/lib tsdown",
        compile: "bun build --compile packages/lib/src/cli.ts --outfile packages/lib/dist/cli",
      },
    ],
  ] as const)("defines namespaced root scripts (%s)", async (layout, expected) => {
    const root = readPackage((await build(layout)).plan.vfs, "package.json");
    expect(root.scripts).toMatchObject(expected);
    expect(root.scripts?.["check:package"]).toContain("publint");
    expect(root.scripts?.["check:package"]).toContain("attw --pack .");
    expect(root.scripts).not.toHaveProperty("build");
  });

  test.each(["single", "monorepo"] as const)(
    "sits next to a web app without colliding (%s)",
    async (layout) => {
      const root = readPackage(
        (await build(layout, ["vite-react", "tsdown"])).plan.vfs,
        "package.json",
      );
      expect(root.scripts).toHaveProperty("build");
      expect(root.scripts).toHaveProperty("build:lib");
    },
  );

  test("is standalone: it does not require a server", async () => {
    const built = await buildSelection(["tsdown"], "single");
    expect(built.ok).toBe(true);
  });

  test("appends the agents Region and ships the skill", async () => {
    const { plan, lockfile } = await build("single");
    expect(String(plan.vfs.read("AGENTS.md"))).toContain("aokit:begin tsdown:agents");
    expect(String(plan.vfs.read(".claude/skills/tsdown-library/SKILL.md"))).toContain(
      "name: tsdown-library",
    );
    expect(lockfile.modules["tsdown"]?.version).toBe("1.0.0");
  });
});
