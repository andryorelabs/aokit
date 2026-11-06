import { afterAll, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { addCommand } from "../../src/cli/commands/add.ts";
import { isJsonObject, objectAt, parseJsonObject, valueAt } from "../helpers/update-json.ts";
import { commitAll, context, createProject, newWorkspace, readLock } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function downgradeToV1(directory: string): Promise<void> {
  const path = join(directory, "aokit.lock.json");
  const lock = parseJsonObject(await readFile(path, "utf8"));
  lock["lockfileVersion"] = 1;
  for (const entry of Object.values(objectAt(lock, "modules"))) {
    if (isJsonObject(entry)) delete entry["selected"];
  }
  for (const entry of Object.values(objectAt(lock, "deps"))) {
    if (isJsonObject(entry)) delete entry["owners"];
  }
  const agentFiles = ["AGENTS.md", "CLAUDE.md"];
  for (const agentFile of agentFiles) delete objectAt(lock, "files")[agentFile];
  await Promise.all(agentFiles.map((agentFile) => rm(join(directory, agentFile), { force: true })));
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
  const raw = parseJsonObject(await readFile(join(directory, "aokit.lock.json"), "utf8"));
  expect(valueAt(raw, "lockfileVersion")).toBe(2);
  const lockfile = await readLock(directory);
  expect(lockfile.deps["knip"]?.owners).toEqual(["knip"]);
  expect(lockfile.deps["oxlint"]?.owners).toEqual(["oxc"]);
  expect(lockfile.deps["oxfmt"]?.owners).toEqual(["oxc"]);
});
