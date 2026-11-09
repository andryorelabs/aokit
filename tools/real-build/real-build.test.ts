import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  combinationLabel,
  curatedCombinations,
  curatedCombinationsOf,
  matrixOf,
  parseCuratedSelection,
  planSteps,
  readCuratedSelections,
} from "./plan.ts";
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
      "monorepo oxc,knip,astro,tailwind4",
      "monorepo oxc,knip,next,prisma,better-auth",
      "monorepo oxc,knip,next,tailwind4",
      "monorepo oxc,knip,next,tailwind4,wxt",
      "monorepo oxc,knip,tsdown",
      "monorepo oxc,knip,vite-react,tailwind4",
      "monorepo oxc,knip,vite-react,tailwind4,base-ui,shadcn",
      "monorepo vite-react,tsdown,hono,hono-zod-validator,oxc,vitest,msw",
      "single astro,tailwind4,oxc,eslint,fontsource,vitest",
      "single next,prisma,better-auth,tailwind4,base-ui,shadcn,shadcn-lint,oxc,eslint,eslint-react,next-themes,fontsource,vitest,vitest-react,msw",
      "single oxc,hono,docker,coolify",
      "single oxc,knip,astro,tailwind4",
      "single oxc,knip,next,prisma,better-auth",
      "single oxc,knip,next,tailwind4",
      "single oxc,knip,next,tailwind4,wxt",
      "single oxc,knip,tsdown",
      "single oxc,knip,vite-react,tailwind4",
      "single oxc,knip,vite-react,tailwind4,base-ui,shadcn",
    ]);
  });
});

describe("curated selections", () => {
  test("reads every curated JSON file by glob", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aokit-curated-"));
    const files: Record<string, string> = {
      "b.json": JSON.stringify({ slug: "b", modules: ["x"], layouts: ["monorepo"] }),
      "a.json": JSON.stringify({ slug: "a", modules: ["y", "z"] }),
      "notes.txt": "ignored",
    };
    await Promise.all(
      Object.entries(files).map(([name, content]) => writeFile(join(directory, name), content)),
    );
    const selections = readCuratedSelections(directory);
    expect(selections.map((selection) => selection.slug)).toEqual(["a", "b"]);
    expect(curatedCombinationsOf(selections).map(combinationLabel)).toEqual([
      "single y,z",
      "monorepo y,z",
      "monorepo x",
    ]);
    expect(matrixOf(selections).include).toEqual([
      { layout: "single", modules: "y,z", slug: "a" },
      { layout: "monorepo", modules: "y,z", slug: "a" },
      { layout: "monorepo", modules: "x", slug: "b" },
    ]);
  });

  test("rejects malformed and duplicate files", async () => {
    expect(() => parseCuratedSelection({ slug: "Bad", modules: ["x"] }, "f.json")).toThrow(/slug/);
    expect(() => parseCuratedSelection({ slug: "ok", modules: [] }, "f.json")).toThrow(/modules/);
    expect(() =>
      parseCuratedSelection({ slug: "ok", modules: ["x"], layouts: ["triple"] }, "f.json"),
    ).toThrow(/layouts/);
    expect(() => parseCuratedSelection("x", "f.json")).toThrow(/object/);
    const directory = await mkdtemp(join(tmpdir(), "aokit-curated-"));
    await writeFile(join(directory, "a.json"), JSON.stringify({ slug: "same", modules: ["x"] }));
    await writeFile(join(directory, "b.json"), JSON.stringify({ slug: "same", modules: ["y"] }));
    expect(() => readCuratedSelections(directory)).toThrow(/unique/);
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

  test("generates the database client between install and build", () => {
    const steps = planSteps(["package.json", "packages/db/package.json"], {
      "package.json": { scripts: { build: "next build" } },
      "packages/db/package.json": { scripts: { "db:generate": "prisma generate" } },
    });
    expect(steps.map((step) => step.name)).toEqual(["install", "generate packages/db", "build ."]);
    expect(steps[1]?.kind).toBe("generate");
  });

  test("runs the extra Module scripts a package declares after the typecheck", () => {
    const steps = planSteps(["package.json", "lib/package.json", "lib/tsconfig.json"], {
      "package.json": {
        scripts: {
          size: "bun run --cwd lib size-limit",
          "build:lib": "bun run --cwd lib tsdown",
          lint: "oxlint",
        },
      },
      "lib/package.json": { scripts: { "test:coverage": "vitest run --coverage" } },
    });
    expect(steps.map((step) => step.name)).toEqual([
      "install",
      "typecheck lib",
      "build:lib .",
      "lint .",
      "size .",
      "test:coverage lib",
    ]);
    expect(steps.at(-1)).toEqual({
      name: "test:coverage lib",
      cwd: "lib",
      kind: "script",
      args: ["run", "test:coverage"],
    });
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
