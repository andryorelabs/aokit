import { afterAll, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { ejectCommand } from "../../src/cli/commands/eject.ts";
import { restoreCommand } from "../../src/cli/commands/restore.ts";
import {
  commitAll,
  context,
  createProject,
  git,
  hashOf,
  newWorkspace,
  readLock,
} from "./helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function restore(directory: string, path: string, extra: Record<string, unknown> = {}) {
  return runCommand(restoreCommand, context, { path, directory, yes: true, ...extra });
}

test("a deleted managed file is recreated with the Lockfile hash", async () => {
  const directory = await createProject(workspace);
  await commitAll(directory);
  const lockHash = (await readLock(directory)).files["src/main.tsx"]?.hash;
  await rm(join(directory, "src/main.tsx"));
  await git(directory, "commit", "-qam", "delete");
  const envelope = await restore(directory, "src/main.tsx");
  expect(envelope.ok).toBe(true);
  expect(await hashOf(directory, "src/main.tsx")).toBe(lockHash ?? "");
  expect((await readLock(directory)).files["src/main.tsx"]?.mode).toBe("managed");
});

test("a modified file is restored and the diff is shown", async () => {
  const directory = await createProject(workspace);
  const lockHash = (await readLock(directory)).files["src/main.tsx"]?.hash;
  await writeFile(join(directory, "src/main.tsx"), "edited\n");
  await commitAll(directory);
  const envelope = await restore(directory, "src/main.tsx");
  expect(envelope.ok).toBe(true);
  expect(JSON.stringify(envelope.data)).toContain("@@");
  expect(await hashOf(directory, "src/main.tsx")).toBe(lockHash ?? "");
});

test("an ejected file becomes managed again; a seed stays seed", async () => {
  const directory = await createProject(workspace);
  const lockfile = await readLock(directory);
  const seed = Object.entries(lockfile.files).find(([, entry]) => entry.mode === "seed")?.[0];
  expect(seed).toBeDefined();
  await runCommand(ejectCommand, context, { path: "src/main.tsx", directory });
  await runCommand(ejectCommand, context, { path: seed ?? "", directory });
  await writeFile(join(directory, "src/main.tsx"), "mine\n");
  await commitAll(directory);
  expect((await restore(directory, "src/main.tsx")).ok).toBe(true);
  expect((await restore(directory, seed ?? "", { allowDirty: true })).ok).toBe(true);
  const after = await readLock(directory);
  expect(after.files["src/main.tsx"]?.mode).toBe("managed");
  expect(after.files[seed ?? ""]?.mode).toBe("seed");
});

test("a dirty tree exits 5 unless --allow-dirty", async () => {
  const directory = await createProject(workspace);
  await commitAll(directory);
  await writeFile(join(directory, "notes.txt"), "x\n");
  const blocked = await restore(directory, "src/main.tsx");
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) {
    expect(blocked.error.code).toBe("DIRTY_TREE");
  }
  expect((await restore(directory, "src/main.tsx", { allowDirty: true })).ok).toBe(true);
});

test("an unknown path fails with NOT_IN_LOCKFILE", async () => {
  const directory = await createProject(workspace);
  const envelope = await restore(directory, "nope.txt");
  expect(envelope.ok).toBe(false);
  if (!envelope.ok) {
    expect(envelope.error.code).toBe("NOT_IN_LOCKFILE");
  }
});

test("a multi-owner file equals its fresh Render", async () => {
  const directory = await createProject(workspace);
  const fresh = await readFile(join(directory, "package.json"), "utf8");
  const owners = (await readLock(directory)).files["package.json"]?.owners ?? [];
  expect(owners.length).toBeGreaterThan(1);
  await writeFile(join(directory, "package.json"), "{}\n");
  await commitAll(directory);
  expect((await restore(directory, "package.json")).ok).toBe(true);
  expect(await readFile(join(directory, "package.json"), "utf8")).toBe(fresh);
});

test("--dry-run and --diff write nothing", async () => {
  const directory = await createProject(workspace);
  await writeFile(join(directory, "src/main.tsx"), "edited\n");
  await commitAll(directory);
  const dry = await restore(directory, "src/main.tsx", { dryRun: true });
  expect(dry.ok).toBe(true);
  const shown = await restore(directory, "src/main.tsx", { diff: true });
  expect(JSON.stringify(shown.data)).toContain("@@");
  expect(await readFile(join(directory, "src/main.tsx"), "utf8")).toBe("edited\n");
});
