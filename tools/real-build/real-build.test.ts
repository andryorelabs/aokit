import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { combinationLabel, curatedCombinations, planSteps } from "./plan.ts";
import { type Exec, runCombination } from "./run.ts";

const failingCreate: Exec = () =>
  Promise.resolve({
    exitCode: 4,
    output: JSON.stringify({ ok: false, data: null, error: { code: "x" } }),
  });

describe("curatedCombinations", () => {
  test("covers both required selections on both Layouts", () => {
    expect(curatedCombinations.map(combinationLabel).toSorted()).toEqual([
      "monorepo oxc,hono,docker,coolify",
      "monorepo oxc,knip,vite-react,tailwind4",
      "single oxc,hono,docker,coolify",
      "single oxc,knip,vite-react,tailwind4",
    ]);
  });
});

describe("planSteps", () => {
  test("installs, builds where a build script exists and typechecks each tsconfig", () => {
    const steps = planSteps(
      ["package.json", "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/src/main.tsx"],
      {
        "package.json": { scripts: { build: "bun run --cwd apps/web vite build" } },
        "apps/web/package.json": { name: "web" },
      },
    );
    expect(steps).toEqual([
      { name: "install", cwd: "", kind: "install", args: ["install"] },
      { name: "build .", cwd: "", kind: "build", args: ["run", "build"] },
      {
        name: "typecheck apps/web",
        cwd: "apps/web",
        kind: "typecheck",
        args: ["--noEmit", "-p", "."],
      },
    ]);
  });

  test("typechecks TypeScript no tsconfig governs with strict flags and bun types", () => {
    const steps = planSteps(
      ["package.json", "apps/server/package.json", "apps/server/src/app.ts"],
      {
        "package.json": { scripts: { start: "bun run apps/server/src/app.ts" } },
        "apps/server/package.json": { devDependencies: { "@types/bun": "catalog:" } },
      },
    );
    expect(steps.map((step) => step.name)).toEqual([
      "install",
      "typecheck apps/server (no tsconfig)",
    ]);
    const typecheck = steps.at(-1);
    expect(typecheck?.cwd).toBe("apps/server");
    expect(typecheck?.args).toContain("--strict");
    expect(typecheck?.args.slice(-3)).toEqual(["--types", "bun", "src/app.ts"]);
  });
});

describe("runCombination", () => {
  test("fails the combination at the typecheck when tsc reports an error", async () => {
    const projectDirectory = join(await mkdtemp(join(tmpdir(), "aokit-real-build-test-")), "app");
    const commands: string[][] = [];
    const exec: Exec = async (command) => {
      commands.push([...command]);
      if (command.includes("create")) {
        const files: Record<string, string> = {
          "package.json": JSON.stringify({ scripts: { build: "vite build" } }),
          "tsconfig.json": "{}",
          "src/routes.tsx": "export const broken: number = 'x';\n",
        };
        await Promise.all(
          Object.entries(files).map(async ([path, content]) => {
            await mkdir(dirname(join(projectDirectory, path)), { recursive: true });
            await writeFile(join(projectDirectory, path), content);
          }),
        );
        return { exitCode: 0, output: JSON.stringify({ ok: true, data: {}, error: null }) };
      }
      const isTsc = command[0]?.endsWith("tsc") === true;
      return isTsc
        ? { exitCode: 2, output: "src/routes.tsx(1,14): error TS2322" }
        : { exitCode: 0, output: "" };
    };
    const result = await runCombination(
      { layout: "single", modules: ["oxc", "vite-react"] },
      { exec, workspaceRoot: "/workspace", projectDirectory, log: () => undefined },
    );
    expect(result).toEqual({
      label: "single oxc,vite-react",
      ok: false,
      failedStep: "typecheck .",
      output: "src/routes.tsx(1,14): error TS2322",
    });
    for (const argument of ["create", "--yes", "--json", "--no-install", "--layout", "single"]) {
      expect(commands[0]).toContain(argument);
    }
    expect(commands.slice(1).map((command) => command.slice(1).join(" "))).toEqual([
      "install",
      "run build",
      "--noEmit -p .",
    ]);
  });

  test("fails at create when the envelope is not ok", async () => {
    const result = await runCombination(
      { layout: "monorepo", modules: ["coolify"] },
      {
        exec: failingCreate,
        workspaceRoot: "/workspace",
        projectDirectory: "/nowhere",
        log: () => undefined,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("create");
  });
});
