import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { cliVersion } from "../../src/cli/version.ts";

const workspaces: string[] = [];
const context = { version: cliVersion, env: {}, commands: [] };

afterAll(() => {
  for (const leftover of workspaces) rmSync(leftover, { recursive: true, force: true });
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-add-"));
  workspaces.push(directory);
  return directory;
}

async function vcs(directory: string, ...args: string[]): Promise<void> {
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
    { cwd: directory, stdout: "ignore", stderr: "ignore" },
  );
  await child.exited;
}

async function createProject(
  directory: string,
  layout: "single" | "monorepo",
  modules: string,
  repository: boolean,
): Promise<void> {
  const envelope = await runCommand(createCommand, context, {
    directory,
    layout,
    modules,
    yes: true,
    install: false,
  });
  expect(envelope.ok).toBe(true);
  if (repository) {
    await vcs(directory, "init", "-q");
    await vcs(directory, "add", "-A");
    await vcs(directory, "commit", "-q", "-m", "init");
  }
}

function addProject(directory: string, extra: Record<string, unknown> = {}) {
  return runCommand(addCommand, context, {
    modules: ["knip"],
    directory,
    yes: true,
    install: false,
    ...extra,
  });
}

function tree(root: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(join(root, prefix)).toSorted()) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (name === ".git" || name === "aokit.lock.json") continue;
    if (statSync(join(root, relative)).isDirectory()) Object.assign(files, tree(root, relative));
    else files[relative] = readFileSync(join(root, relative), "utf8");
  }
  return files;
}

describe("aokit add", () => {
  test.each(["single", "monorepo"] as const)("equals a fresh create (%s)", async (layout) => {
    const added = join(workspace(), "p");
    const fresh = join(workspace(), "p");
    await createProject(added, layout, "oxc", true);
    await createProject(fresh, layout, "oxc,knip", false);
    const envelope = await addProject(added);
    expect(envelope.ok).toBe(true);
    expect(tree(added)).toEqual(tree(fresh));
    const doctor = await runCommand(doctorCommand, context, { directory: added });
    expect(doctor.ok).toBe(true);
    const addedLock = JSON.parse(readFileSync(join(added, "aokit.lock.json"), "utf8"));
    const freshLock = JSON.parse(readFileSync(join(fresh, "aokit.lock.json"), "utf8"));
    expect(addedLock.files).toEqual(freshLock.files);
    expect(Object.keys(addedLock.modules)).toEqual(Object.keys(freshLock.modules));
  });

  test("an untracked file exits 5 unless --allow-dirty", async () => {
    const directory = join(workspace(), "p");
    await createProject(directory, "single", "oxc", true);
    writeFileSync(join(directory, "notes.txt"), "x");
    const rejected = await addProject(directory);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe("DIRTY_TREE");
      expect(rejected.error.message).toContain("notes.txt");
    }
    expect((await addProject(directory, { allowDirty: true })).ok).toBe(true);
  });

  test("a missing Module is a Resolver rejection and writes nothing", async () => {
    const directory = join(workspace(), "p");
    await createProject(directory, "single", "oxc", true);
    const before = tree(directory);
    const envelope = await addProject(directory, { modules: ["nope"] });
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.code).toBe("REQUIREMENT_UNMET");
      expect(envelope.data).toEqual({ resolverCode: "unknown_module" });
    }
    expect(tree(directory)).toEqual(before);
  });

  test("a provider pulled in through requires is recorded selected:false", async () => {
    const directory = join(workspace(), "p");
    await createProject(directory, "single", "oxc", true);
    const envelope = await addProject(directory, { modules: ["coolify"] });
    expect(envelope.ok).toBe(true);
    const lock = JSON.parse(readFileSync(join(directory, "aokit.lock.json"), "utf8"));
    expect(lock.modules.coolify.selected).toBe(true);
    expect(lock.modules.docker.selected).toBe(false);
    if (envelope.ok) {
      expect(addCommand.output.parse(envelope.data).pulledIn).toContain("docker");
    }
  });

  test.each([{ dryRun: true }, { diff: true }])("%o writes nothing", async (flag) => {
    const directory = join(workspace(), "p");
    await createProject(directory, "single", "oxc", true);
    const before = tree(directory);
    const envelope = await addProject(directory, flag);
    expect(envelope.ok).toBe(true);
    expect(tree(directory)).toEqual(before);
    if (envelope.ok) {
      const data = addCommand.output.parse(envelope.data);
      expect(data.applied).toBe(false);
      expect(data.plan.changes.length).toBeGreaterThan(0);
    }
  });

  test("conflicts exit 6 with paths and Provenance", async () => {
    const directory = join(workspace(), "p");
    await createProject(directory, "single", "oxc", true);
    writeFileSync(join(directory, "knip.json"), "{}\n");
    await vcs(directory, "add", "-A");
    await vcs(directory, "commit", "-q", "-m", "user knip");
    const envelope = await addProject(directory);
    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.code).toBe("MERGE_CONFLICTS");
      const data = z.object({ conflicts: z.array(z.object({ path: z.string() })) });
      expect(data.parse(envelope.data).conflicts.length).toBeGreaterThan(0);
    }
  });
});
