import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import { runCommand } from "../../src/cli/command.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { buildUpdatePlan } from "../../src/update/run.ts";
import { abortUpdate, readUpdateMarker } from "../../src/update/state.ts";
import { openGit } from "../../src/git/index.ts";
import {
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  editLockfile,
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

const throwingScript = `import { defineMigration } from "@aokit/module";

export default defineMigration(() => {
  throw new Error("boom");
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

describe("aokit update", () => {
  test("moves a renamed file with the user's edit, rewrites imports and records the Release", async () => {
    const { directory } = await project();
    await writeFile(join(directory, "notes.md"), "# app\nmy own line\n");
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(join(directory, "src/user.ts"), `import n from "./notes";\n`);
    await commitAll(directory);
    const envelope = await run({ directory, yes: true, install: false });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(updateCommand.output.parse(envelope.data).applied).toBe(true);
    expect(updateCommand.output.parse(envelope.data).release).toBe("2026.11.1");
    expect(await exists(directory, "notes.md")).toBe(false);
    expect(await read(directory, "docs/notes.md")).toContain("my own line");
    expect(await read(directory, "src/user.ts")).toBe(`import n from "./docs/notes";\n`);
    const lockfile = JSON.parse(await read(directory, "aokit.lock.json"));
    expect(Object.values<{ release: string }>(lockfile.registries)[0]?.release).toBe("2026.11.1");
    expect(lockfile.modules.oxc.version).toBe("1.1.0");
    expect(lockfile.files["docs/notes.md"]).toBeDefined();
    expect(lockfile.files["notes.md"]).toBeUndefined();
    expect(
      updateCommand.output.parse(envelope.data).migrations.map((entry) => entry.script),
    ).toEqual(["migrations/to-1-1.after.js"]);
  });

  test("a before Migration that moves a user file deletes the original", async () => {
    const { directory } = await project({
      beforeScript: `import { defineMigration } from "@aokit/module";

export default defineMigration(({ vfs }) => {
  const text = vfs.read("src/legacy.ts");
  if (text !== undefined) {
    vfs.write("src/current.ts", text);
    vfs.delete("src/legacy.ts");
  }
});
`,
    });
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(join(directory, "src/legacy.ts"), "export const legacy = 1;\n");
    await commitAll(directory);
    const envelope = await run({ directory, yes: true, install: false });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(await exists(directory, "src/legacy.ts")).toBe(false);
    expect(await read(directory, "src/current.ts")).toBe("export const legacy = 1;\n");
  });

  test("a before Migration that renames an answer is recorded in the Lockfile", async () => {
    const { directory } = await project({
      beforeScript: `import { defineMigration } from "@aokit/module";

export default defineMigration(({ answers }) => {
  const { appRouter, ...rest } = answers;
  return { ...rest, router: appRouter };
});
`,
    });
    await editLockfile(directory, (lockfile) => {
      lockfile.modules.oxc.answers = { appRouter: "tanstack" };
    });
    await commitAll(directory);
    const envelope = await run({ directory, yes: true, install: false });
    if (!envelope.ok) throw new Error(envelope.error.message);
    const lockfile = JSON.parse(await read(directory, "aokit.lock.json"));
    expect(lockfile.modules.oxc.answers).toEqual({ router: "tanstack" });
  });

  test("keeps a pinned dependency at its locked version and lists it", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const before = JSON.parse(await read(directory, "aokit.lock.json"));
    const envelope = await run({ directory, yes: true, install: false });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(updateCommand.output.parse(envelope.data).keptDeps).toEqual([
      { name: "oxlint", kept: before.deps.oxlint.version, available: "1.91.0", reason: "pinned" },
    ]);
    const lockfile = JSON.parse(await read(directory, "aokit.lock.json"));
    expect(lockfile.deps.oxlint.version).toBe(before.deps.oxlint.version);
    expect(await read(directory, "package.json")).not.toContain("1.91.0");
  });

  test("buildUpdatePlan returns the Plan and writes nothing", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const lockfile = await read(directory, "aokit.lock.json");
    const result = await buildUpdatePlan({
      dir: directory,
      allowDirty: false,
      dryRun: false,
      diff: false,
      yes: false,
      install: false,
      cliVersion: commandContext.version,
    });
    expect(result.applied).toBe(false);
    expect(result.plan?.changes.map((change) => change.path)).toContain("docs/notes.md");
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
  });

  test("a Project on the target Release has nothing to update and nothing is written", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const first = await run({ directory, yes: true, install: false });
    expect(first.ok).toBe(true);
    await gitIn(directory, "add", "-A");
    await gitIn(directory, "commit", "-q", "-m", "updated");
    const lockfile = await read(directory, "aokit.lock.json");
    const second = await run({ directory, yes: true, install: false });
    if (!second.ok) throw new Error(second.error.message);
    expect(updateCommand.output.parse(second.data).upToDate).toBe(true);
    expect(updateCommand.output.parse(second.data).message).toContain("Nothing to update");
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
  });

  test("an older Release is INVALID_INPUT and exits 3", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const envelope = await run({ directory, to: "2026.10.0", yes: true, install: false });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) expect(envelope.error.code).toBe("INVALID_INPUT");
  });

  test("without --yes and without a terminal it fails with MISSING_VALUE and writes nothing", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const lockfile = await read(directory, "aokit.lock.json");
    const envelope = await run({ directory, install: false });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) expect(envelope.error.code).toBe("MISSING_VALUE");
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
  });

  test("--dry-run and --diff show the Plan without asking or writing", async () => {
    const { directory } = await project();
    await commitAll(directory);
    const lockfile = await read(directory, "aokit.lock.json");
    const envelope = await run({ directory, diff: true, install: false });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(updateCommand.output.parse(envelope.data).applied).toBe(false);
    expect(updateCommand.output.parse(envelope.data).diff).toContain("docs/notes.md");
    const dry = await run({ directory, dryRun: true, install: false });
    expect(dry.ok).toBe(true);
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
    expect(await exists(directory, "docs/notes.md")).toBe(false);
  });

  test("a throwing Migration is MIGRATION_FAILED and the tree is unchanged", async () => {
    const { directory } = await project({ script: throwingScript });
    await commitAll(directory);
    const lockfile = await read(directory, "aokit.lock.json");
    const envelope = await run({ directory, yes: true, install: false });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.code).toBe("MIGRATION_FAILED");
      expect(envelope.error.message).toContain("oxc");
    }
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
    expect(await exists(directory, "notes.md")).toBe(true);
  });

  test("a renamed file the user deleted stays deleted", async () => {
    const { directory } = await project();
    await gitIn(directory, "init", "-q");
    await writeFile(join(directory, "ignore.me"), "");
    await gitIn(directory, "add", "-A");
    await gitIn(directory, "commit", "-q", "-m", "init");
    await Bun.$`rm ${join(directory, "notes.md")}`;
    await gitIn(directory, "commit", "-aq", "-m", "delete notes");
    const envelope = await run({ directory, yes: true, install: false });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(await exists(directory, "docs/notes.md")).toBe(false);
    expect(await exists(directory, "notes.md")).toBe(false);
  });

  test("Conflicts exit 6 with the stash kept, and --abort state restores the original tree", async () => {
    const { directory } = await project({ notes: "# renamed {{name}}\n" });
    await writeFile(join(directory, "notes.md"), "# mine\n");
    await commitAll(directory);
    const lockfile = await read(directory, "aokit.lock.json");
    const originalRc = await read(directory, "notes.md");
    const envelope = await run({ directory, yes: true, install: false });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) expect(envelope.error.code).toBe("MERGE_CONFLICTS");
    const repository = (await openGit(directory)) ?? undefined;
    const marker = await readUpdateMarker(directory, repository);
    expect(marker?.conflictedPaths).toEqual(["docs/notes.md"]);
    expect(await read(directory, "docs/notes.md")).toContain("<<<<<<<");
    await abortUpdate(directory, repository);
    expect(await read(directory, "notes.md")).toBe(originalRc);
    expect(await read(directory, "aokit.lock.json")).toBe(lockfile);
    expect(await readUpdateMarker(directory, repository)).toBeNull();
    expect(await gitIn(directory, "ls-files", "-u")).toBe("");
    expect(await exists(directory, "docs/notes.md")).toBe(false);
  });
});
