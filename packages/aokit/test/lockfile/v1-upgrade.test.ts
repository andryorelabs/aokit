import { afterAll, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { commitAll, context, createProject, newWorkspace, readLock } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function downgradeToV1(directory: string): Promise<void> {
  const path = join(directory, "aokit.lock.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  lock.lockfileVersion = 1;
  for (const entry of Object.values<Record<string, unknown>>(lock.modules)) delete entry.selected;
  for (const entry of Object.values<Record<string, unknown>>(lock.deps)) delete entry.owners;
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
}

test("add on a v1 Lockfile writes v2 with exact dep owners", async () => {
  const directory = await createProject(workspace, "oxc");
  await downgradeToV1(directory);
  await commitAll(directory);
  const envelope = await runCommand(addCommand, context, {
    modules: ["knip"],
    directory,
    yes: true,
    install: false,
  });
  expect(envelope.ok).toBe(true);
  const raw = JSON.parse(await readFile(join(directory, "aokit.lock.json"), "utf8"));
  expect(raw.lockfileVersion).toBe(2);
  const lockfile = await readLock(directory);
  expect(lockfile.deps["knip"]?.owners).toEqual(["knip"]);
  expect(lockfile.deps["oxlint"]?.owners).toEqual(["oxc"]);
  expect(lockfile.deps["oxfmt"]?.owners).toEqual(["oxc"]);
});
