import { afterAll, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { recopyCommand } from "../../src/cli/commands/recopy.ts";
import { objectAt, parseJsonObject } from "../helpers/update-json.ts";
import { commitAll, context, createProject, newWorkspace } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function recopy(directory: string) {
  return runCommand(recopyCommand, context, { directory, yes: true, install: false });
}

test("a directory without a Lockfile fails with LOCKFILE_MISSING", async () => {
  const directory = join(workspace, "empty");
  await mkdir(directory);
  const envelope = await recopy(directory);
  expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
});

test("an unparsable Lockfile fails with LOCKFILE_MISSING", async () => {
  const directory = join(workspace, "broken");
  await mkdir(directory);
  await writeFile(join(directory, "aokit.lock.json"), "not json");
  const envelope = await recopy(directory);
  expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
});

test("a Lockfile path that is a directory surfaces the read failure", async () => {
  const directory = join(workspace, "dir-lock");
  await mkdir(join(directory, "aokit.lock.json"), { recursive: true });
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(false);
});

test("a Registry that cannot be read fails without a substitution", async () => {
  const directory = await createProject(workspace);
  const path = join(directory, "aokit.lock.json");
  const lock = parseJsonObject(await readFile(path, "utf8"));
  objectAt(lock, "registries", "official")["source"] = join(workspace, "no-such-registry");
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
  await commitAll(directory);
  const envelope = await recopy(directory);
  expect(envelope.ok).toBe(false);
});
