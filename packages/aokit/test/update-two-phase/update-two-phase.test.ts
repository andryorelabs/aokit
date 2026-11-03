import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { readUpdateMarker } from "../../src/update/state.ts";
import { openGit } from "../../src/git/index.ts";
import {
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  temporaryDirectory,
} from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

const secondCatalog = `${JSON.stringify(
  {
    release: "2026.11.1",
    dependencies: { oxfmt: "0.75.0", oxlint: "1.91.0" },
    pinGroups: { oxc: ["oxlint", "oxfmt"] },
  },
  null,
  2,
)}\n`;

const secondModule = `export default {
  name: "oxc",
  version: "1.1.0",
  provides: ["lint", "format"],
  files: [
    { from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" },
    { from: "files/nested/notes.md", to: "docs/notes.md", target: "root" },
  ],
  deps: { devDependencies: { oxlint: { range: "catalog", pinGroup: "oxc" } } },
  migrations: [
    { from: ">=1 <2", to: "1.1.0", stage: "after", script: "migrations/to-1-1.after.js" },
  ],
};
`;

const afterScript = `import { defineMigration } from "@aokit/module";

export default defineMigration(({ vfs }) => {
  for (const path of vfs.list("src/")) {
    const text = vfs.read(path);
    if (text !== undefined && text.includes("./notes")) {
      vfs.write(path, text.replaceAll("./notes", "./docs/notes"));
    }
  }
});
`;

interface Options {
  readonly script?: string;
  readonly notes?: string;
  readonly beforeScript?: string;
}

async function publishSecondRelease(out: string, options: Options): Promise<void> {
  const source = await writeRegistrySourceFixture();
  await mkdir(join(source, "oxc/migrations"), { recursive: true });
  await Promise.all([
    writeFile(
      join(source, "oxc/module.ts"),
      options.beforeScript === undefined
        ? secondModule
        : secondModule
            .replace("  provides:", `  answers: { router: { type: "string" } },\n  provides:`)
            .replace(
              "  ],\n};",
              `    { from: ">=1 <2", to: "1.1.0", stage: "before", script: "migrations/to-1-1.before.js" },\n  ],\n};`,
            ),
      "utf8",
    ),
    ...(options.beforeScript === undefined
      ? []
      : [writeFile(join(source, "oxc/migrations/to-1-1.before.ts"), options.beforeScript, "utf8")]),
    writeFile(join(source, "oxc/renames.json"), `{ "notes.md": "docs/notes.md" }\n`, "utf8"),
    writeFile(
      join(source, "oxc/migrations/to-1-1.after.ts"),
      options.script ?? afterScript,
      "utf8",
    ),
    writeFile(join(source, "catalog/2026.11.1.json"), secondCatalog, "utf8"),
    ...(options.notes === undefined
      ? []
      : [writeFile(join(source, "oxc/files/nested/notes.md"), options.notes, "utf8")]),
  ]);
  await buildRegistry(source, out);
}

async function run(args: Record<string, unknown>) {
  return runCommand(updateCommand, commandContext, args);
}

async function gitIn(directory: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn(
    [
      "git",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  );
  const [out] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return out;
}

async function project(options: Options = {}) {
  const source = await writeRegistrySourceFixture();
  const registry = await temporaryDirectory();
  await buildRegistry(source, registry);
  const directory = await createProject(registry);
  await publishSecondRelease(registry, options);
  return { directory, registry };
}

async function commitAll(directory: string): Promise<void> {
  await gitIn(directory, "init", "-q");
  await gitIn(directory, "add", "-A");
  await gitIn(directory, "commit", "-q", "-m", "init");
}

const read = (directory: string, path: string) => readFile(join(directory, path), "utf8");

async function exists(directory: string, path: string): Promise<boolean> {
  try {
    await stat(join(directory, path));
    return true;
  } catch {
    return false;
  }
}

describe("aokit update --plan / --apply / --abort", () => {
  test("--plan writes plan.json inside the git dir and leaves the Project unchanged; --apply writes the Plan", async () => {
    const { directory } = await project();
    await writeFile(join(directory, "notes.md"), "# mine {{name}}\n");
    await commitAll(directory);
    const before = await read(directory, "aokit.lock.json");
    const planned = await run({ directory, plan: true, install: false });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const data = updateCommand.output.parse(planned.data);
    expect(data.applied).toBe(false);
    expect(data.planFile).toBe(join(directory, ".git", "aokit", "plan.json"));
    expect(await read(directory, "aokit.lock.json")).toBe(before);
    expect(await gitIn(directory, "status", "--porcelain")).toBe("");
    const applied = await run({ directory, apply: true, yes: true, install: false });
    expect(applied.ok).toBe(true);
    expect(await read(directory, "docs/notes.md")).toContain("mine");
    expect(JSON.parse(await read(directory, "aokit.lock.json")).registries).toBeDefined();
    expect(await exists(join(directory, ".git"), "aokit/plan.json")).toBe(false);
  });

  test("--apply without a plan exits 5 PLAN_MISSING", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const envelope = await run({ directory, apply: true, yes: true, install: false });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.code).toBe("PLAN_MISSING");
    }
  });

  test("--apply after an edit between plan and apply is PLAN_STALE naming the file", async () => {
    const { directory } = await project();
    await commitAll(directory);
    await run({ directory, plan: true, install: false });
    await writeFile(join(directory, "notes.md"), "edited later\n");
    const envelope = await run({ directory, apply: true, yes: true, install: false });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.code).toBe("PLAN_STALE");
      expect(envelope.error.message).toContain("notes.md");
    }
  });

  test("--plan outside git writes .aokit/plan.json, and --abort removes it", async () => {
    const { directory } = await project();
    const planned = await run({ directory, plan: true, install: false, allowDirty: true });
    expect(planned.ok).toBe(true);
    expect(await exists(directory, ".aokit/plan.json")).toBe(true);
    const aborted = await run({ directory, abort: true });
    expect(aborted.ok).toBe(true);
    expect(await exists(directory, ".aokit/plan.json")).toBe(false);
  });

  test("--abort with nothing to abort exits 0", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const envelope = await run({ directory, abort: true });
    expect(envelope.ok).toBe(true);
    if (envelope.ok) expect(updateCommand.output.parse(envelope.data).aborted).toBe(false);
  });

  test("a conflicted --apply keeps the stash and --abort restores the tree, also in a linked worktree", async () => {
    const { directory } = await project({ notes: "# renamed {{name}}\n" });
    await writeFile(join(directory, "notes.md"), "# mine\n");
    await commitAll(directory);
    const lockfile = await read(directory, "aokit.lock.json");
    const planned = await run({ directory, plan: true, install: false });
    expect(planned.ok).toBe(true);
    const applied = await run({ directory, apply: true, yes: true, install: false });
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.error.code).toBe("MERGE_CONFLICTS");
    const repository = (await openGit(directory)) ?? undefined;
    expect((await readUpdateMarker(directory, repository))?.conflictedPaths).toEqual([
      "docs/notes.md",
    ]);
    const aborted = await run({ directory, abort: true });
    expect(aborted.ok).toBe(true);
    expect(await read(directory, "notes.md")).toBe("# mine\n");
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
    expect(await readUpdateMarker(directory, repository)).toBeNull();
    expect(await gitIn(directory, "ls-files", "-u")).toBe("");
    expect(await exists(directory, "docs/notes.md")).toBe(false);
  });

  test("--abort in a linked git worktree uses the worktree git dir", async () => {
    const { directory } = await project({ notes: "# renamed {{name}}\n" });
    await writeFile(join(directory, "notes.md"), "# mine\n");
    await commitAll(directory);
    const linked = join(await temporaryDirectory(), "linked");
    await gitIn(directory, "worktree", "add", "-q", "-b", "other", linked);
    const lockfile = await read(linked, "aokit.lock.json");
    const conflicted = await run({ directory: linked, yes: true, install: false });
    expect(conflicted.ok).toBe(false);
    const aborted = await run({ directory: linked, abort: true });
    expect(aborted.ok).toBe(true);
    expect(await read(linked, "notes.md")).toBe("# mine\n");
    expect(await read(linked, "aokit.lock.json")).toBe(lockfile);
    expect(await gitIn(linked, "ls-files", "-u")).toBe("");
  });

  test("plan, apply and abort cannot be combined", async () => {
    const { directory } = await project();
    const envelope = await run({ directory, plan: true, apply: true });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) expect(envelope.error.code).toBe("INVALID_INPUT");
  });

  test("the saved plan.json validates against the plan file schema", async () => {
    const { directory } = await project();
    await writeFile(join(directory, "ñandú notes.md"), "x\n");
    await commitAll(directory);
    const { planFileSchema } = await import("../../src/update/plan-file.ts");
    const planned = await run({ directory, plan: true, install: false });
    expect(planned.ok).toBe(true);
    const text = await read(join(directory, ".git"), "aokit/plan.json");
    expect(planFileSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });
});
