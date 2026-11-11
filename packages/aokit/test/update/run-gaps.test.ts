import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { applyUpdatePlan, planUpdate, runUpdate, type UpdateInput } from "../../src/update/run.ts";
import {
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  temporaryDirectory,
} from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

const posixShellTest = process.platform === "win32" ? test.skip : test;

const nextModule = `export default {
  name: "oxc",
  version: "1.1.0",
  description: "Fixture Oxc linting.",
  provides: ["lint", "format"],
  files: [
    { from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" },
    { from: "files/nested/notes.md", to: "notes.md", target: "root" },
    { from: "files/nested/notes.md", to: "docs/guide.md", target: "root" },
  ],
  deps: {
    devDependencies: {
      oxlint: { range: "catalog", pinGroup: "oxc" },
      oxfmt: { range: "catalog", pinGroup: "oxc" },
    },
  },
  migrations: [
    { from: ">=1 <2", to: "1.1.0", stage: "after", script: "migrations/to-1-1.after.js" },
  ],
};
`;

const afterMigration = `import { defineMigration } from "@aokit/module";

export default defineMigration(({ vfs, context }) => {
  vfs.write("src/seed.txt", String(context.random()));
});
`;

const nextCatalog = `${JSON.stringify(
  {
    release: "2026.11.1",
    dependencies: { oxfmt: "0.75.0", oxlint: "1.91.0" },
    pinGroups: { oxc: ["oxlint", "oxfmt"] },
  },
  null,
  2,
)}\n`;

async function projectWithNewRelease(): Promise<string> {
  const first = await writeRegistrySourceFixture();
  const registry = await temporaryDirectory();
  await buildRegistry(first, registry);
  const directory = await createProject(registry);
  const next = await writeRegistrySourceFixture();
  await mkdir(join(next, "oxc/migrations"), { recursive: true });
  await Promise.all([
    writeFile(join(next, "oxc/module.ts"), nextModule, "utf8"),
    writeFile(join(next, "oxc/migrations/to-1-1.after.ts"), afterMigration, "utf8"),
    writeFile(join(next, "catalog/2026.11.1.json"), nextCatalog, "utf8"),
  ]);
  await buildRegistry(next, registry);
  return directory;
}

function inputFor(dir: string, overrides: Partial<UpdateInput> = {}): UpdateInput {
  return {
    dir,
    allowDirty: true,
    dryRun: false,
    diff: false,
    yes: false,
    install: false,
    cliVersion: commandContext.version,
    ...overrides,
  };
}

const lockfileText = (dir: string) => readFile(join(dir, "aokit.lock.json"), "utf8");

describe("update confirmation", () => {
  test("the Plan summary is shown and an accepted update is applied", async () => {
    const dir = await projectWithNewRelease();
    const summaries: string[] = [];
    const result = await runUpdate(
      inputFor(dir, {
        confirm: (summary) => {
          summaries.push(summary);
          return Promise.resolve(true);
        },
      }),
    );
    expect(result.applied).toBe(true);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toStartWith("Update to Release 2026.11.1:\n ");
    expect(summaries[0]).toContain("package.json");
  });

  test("a declined update is INTERRUPTED and writes nothing", async () => {
    const dir = await projectWithNewRelease();
    const before = await lockfileText(dir);
    const failure = await runUpdate(inputFor(dir, { confirm: () => Promise.resolve(false) })).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "INTERRUPTED" });
    expect(await lockfileText(dir)).toBe(before);
  });

  test("the update command asks through the terminal prompt when interactive", async () => {
    const dir = await projectWithNewRelease();
    const questions: string[] = [];
    const declined = await runCommand(
      updateCommand,
      {
        ...commandContext,
        interactive: true,
        prompt: (question) => {
          questions.push(question);
          return Promise.resolve("n");
        },
      },
      { directory: dir, allowDirty: true, install: false },
    );
    expect(declined.ok).toBe(false);
    expect(questions[0]).toEndWith("Apply this update? [y/N] ");
    const accepted = await runCommand(
      updateCommand,
      { ...commandContext, interactive: true, prompt: () => Promise.resolve(" Yes ") },
      { directory: dir, allowDirty: true, install: false },
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(updateCommand.output.parse(accepted.data).applied).toBe(true);
  });
});

describe("Migrations", () => {
  test("a Migration runs with the deterministic context of an update", async () => {
    const dir = await projectWithNewRelease();
    const result = await runUpdate(inputFor(dir, { yes: true }));
    expect(result.migrations.map((entry) => entry.script)).toEqual(["migrations/to-1-1.after.js"]);
    expect(await readFile(join(dir, "src/seed.txt"), "utf8")).toBe("0");
  });
});

describe("saved Plan", () => {
  test("applying with --dry-run returns the saved Plan and its diff without writing", async () => {
    const dir = await projectWithNewRelease();
    const planned = await planUpdate(inputFor(dir));
    expect(planned.planPath).toBeDefined();
    const before = await lockfileText(dir);
    const result = await applyUpdatePlan(inputFor(dir, { dryRun: true }));
    expect(result.applied).toBe(false);
    expect(result.stashKept).toBe(false);
    expect(result.diff).toContain("package.json");
    expect(await lockfileText(dir)).toBe(before);
  });

  test("applying a Plan that changes package.json installs through the installer", async () => {
    const dir = await projectWithNewRelease();
    await planUpdate(inputFor(dir));
    const installed: string[] = [];
    const result = await applyUpdatePlan(
      inputFor(dir, {
        yes: true,
        install: true,
        installer: (directory) => {
          installed.push(directory);
          return Promise.resolve();
        },
      }),
    );
    expect(result.applied).toBe(true);
    expect(result.installed).toBe(true);
    expect(installed).toEqual([dir]);
  });

  posixShellTest("without an installer the Project's own bun install runs", async () => {
    const dir = await projectWithNewRelease();
    await planUpdate(inputFor(dir));
    const bin = join(await temporaryDirectory(), "bin");
    await mkdir(bin);
    await writeFile(join(bin, "bun"), "#!/bin/sh\necho installed > install-marker\n", "utf8");
    await chmod(join(bin, "bun"), 0o755);
    const originalPath = process.env["PATH"];
    process.env["PATH"] = `${bin}:${originalPath ?? ""}`;
    try {
      const result = await applyUpdatePlan(inputFor(dir, { yes: true, install: true }));
      expect(result.installed).toBe(true);
    } finally {
      if (originalPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = originalPath;
    }
    expect((await readFile(join(dir, "install-marker"), "utf8")).trim()).toBe("installed");
  });

  test("a Project without a Lockfile cannot be planned", async () => {
    const dir = await projectWithNewRelease();
    await rm(join(dir, "aokit.lock.json"));
    const failure = await planUpdate(inputFor(dir)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "LOCKFILE_MISSING" });
  });
});
