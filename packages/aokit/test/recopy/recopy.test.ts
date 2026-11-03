import { afterAll, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { ejectCommand } from "../../src/cli/commands/eject.ts";
import { recopyCommand } from "../../src/cli/commands/recopy.ts";
import { commitAll, context, createProject, newWorkspace, readLock } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function recopy(directory: string, extra: Record<string, unknown> = {}) {
  return runCommand(recopyCommand, context, { directory, yes: true, install: false, ...extra });
}

async function lockWith(directory: string, change: (lock: Record<string, any>) => void) {
  const path = join(directory, "aokit.lock.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  change(lock);
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
}

test("a locked version missing from the Registry renders the latest and notes it", async () => {
  const directory = await createProject(workspace);
  const latest = (await readLock(directory)).modules.oxc?.version;
  await lockWith(directory, (lock) => {
    lock.modules.oxc.version = "0.0.1";
  });
  await commitAll(directory);
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(true);
  if (!envelope.ok) return;
  expect(JSON.stringify(envelope.data)).toContain("oxc@0.0.1");
  expect((await readLock(directory)).modules.oxc?.version).toBe(latest ?? "");
});

test("a pristine Project recopies to no change", async () => {
  const directory = await createProject(workspace);
  await commitAll(directory);
  const before = await readFile(join(directory, "aokit.lock.json"), "utf8");
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(true);
  expect(await readFile(join(directory, "aokit.lock.json"), "utf8")).toBe(before);
});

test("an edited managed file conflicts with markers and exits 6", async () => {
  const directory = await createProject(workspace);
  await writeFile(join(directory, "src/main.tsx"), "edited\n");
  await commitAll(directory);
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(false);
  if (envelope.ok) return;
  expect(envelope.error.code).toBe("MERGE_CONFLICTS");
  const content = await readFile(join(directory, "src/main.tsx"), "utf8");
  expect(content).toContain("<<<<<<<");
  expect(content).toContain("edited");
});

test("a deleted managed file stays deleted", async () => {
  const directory = await createProject(workspace);
  await rm(join(directory, "src/main.tsx"));
  await commitAll(directory);
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(true);
  expect(await Bun.file(join(directory, "src/main.tsx")).exists()).toBe(false);
});

test("seed and ejected files that differ are kept untouched", async () => {
  const directory = await createProject(workspace);
  const lock = await readLock(directory);
  const seed = Object.entries(lock.files).find(([, entry]) => entry.mode === "seed")?.[0];
  expect(seed).toBeDefined();
  const ejected = await runCommand(ejectCommand, context, { path: "src/main.tsx", directory });
  expect(ejected.ok).toBe(true);
  await writeFile(join(directory, "src/main.tsx"), "mine\n");
  await writeFile(join(directory, seed ?? ""), "my seed\n");
  await commitAll(directory);
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(true);
  expect(await readFile(join(directory, "src/main.tsx"), "utf8")).toBe("mine\n");
  expect(await readFile(join(directory, seed ?? ""), "utf8")).toBe("my seed\n");
  expect((await readLock(directory)).files["src/main.tsx"]?.mode).toBe("ejected");
});

test("a dirty tree is rejected", async () => {
  const directory = await createProject(workspace);
  await commitAll(directory);
  await writeFile(join(directory, "notes.txt"), "x\n");
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(false);
  if (envelope.ok) return;
  expect(envelope.error.code).toBe("DIRTY_TREE");
});
