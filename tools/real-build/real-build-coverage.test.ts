import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { planSteps } from "./plan.ts";
import { type Exec, runCombination } from "./run.ts";

const workspaceRoot = join(import.meta.dir, "..", "..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function projectWith(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aokit-real-build-coverage-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content, "utf8");
    }),
  );
  return directory;
}

const notJson: Exec = () => Promise.resolve({ exitCode: 0, output: "not json" });
const createdOk = JSON.stringify({ ok: true, data: {} });
const combination = { layout: "single", modules: ["oxc"] } as const;

describe("planSteps for sources outside any tsconfig", () => {
  test("checks each package with sources separately, in codepoint order", () => {
    const steps = planSteps(
      ["package.json", "packages/b/package.json", "packages/b/src/b.ts", "packages/a/src/a.ts"],
      {
        "package.json": { devDependencies: { "@types/bun": "1" } },
        "packages/b/package.json": {},
      },
    );
    const typechecks = steps.filter((step) => step.kind === "typecheck");
    expect(typechecks.map((step) => step.name)).toEqual([
      "typecheck . (no tsconfig)",
      "typecheck packages/b (no tsconfig)",
    ]);
    expect(typechecks.every((step) => step.args.includes("bun"))).toBe(true);
  });
});

describe("runCombination against a stubbed CLI", () => {
  test("create output that is not JSON fails the create step", async () => {
    const result = await runCombination(combination, {
      exec: notJson,
      workspaceRoot,
      projectDirectory: await projectWith({}),
      log: () => undefined,
    });
    expect(result).toEqual({
      label: "single oxc",
      ok: false,
      failedStep: "create",
      output: "not json",
    });
  });

  test("a Project whose steps all pass is reported ok", async () => {
    const commands: (readonly string[])[] = [];
    const exec: Exec = (command) => {
      commands.push(command);
      return Promise.resolve({ exitCode: 0, output: createdOk });
    };
    const result = await runCombination(combination, {
      exec,
      workspaceRoot,
      projectDirectory: await projectWith({ "package.json": "{}" }),
      log: () => undefined,
    });
    expect(result).toEqual({ label: "single oxc", ok: true });
    expect(commands.at(-1)).toEqual(["bun", "install"]);
  });

  test("the generate step runs with a placeholder DATABASE_URL", async () => {
    const commands: (readonly string[])[] = [];
    const exec: Exec = (command) => {
      commands.push(command);
      return Promise.resolve({ exitCode: 0, output: createdOk });
    };
    const result = await runCombination(combination, {
      exec,
      workspaceRoot,
      projectDirectory: await projectWith({
        "package.json": JSON.stringify({ scripts: { "db:generate": "prisma generate" } }),
      }),
      log: () => undefined,
    });
    expect(result.ok).toBe(true);
    const generate = commands.find((command) => command[0] === "env");
    expect(generate?.[1]).toStartWith("DATABASE_URL=postgresql://");
    expect(generate?.slice(2)).toEqual(["bun", "run", "db:generate"]);
  });
});
