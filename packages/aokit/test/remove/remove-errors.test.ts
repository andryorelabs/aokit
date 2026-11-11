import { afterAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { type JsonObject, objectAt, parseJsonObject } from "../helpers/update-json.ts";

const context = { version: cliVersion, env: {}, commands: [] };
const workspace = mkdtempSync(join(tmpdir(), "aokit-remove-errors-"));
let counter = 0;

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function createProject(): Promise<string> {
  counter += 1;
  const directory = join(workspace, `app-${counter}`);
  const envelope = await runCommand(createCommand, context, {
    directory,
    modules: "oxc,knip",
    yes: true,
    install: false,
    git: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  return directory;
}

function remove(directory: string, module: string) {
  return runCommand(removeCommand, context, {
    module,
    directory,
    yes: true,
    install: false,
    allowDirty: true,
  });
}

async function editLockfile(
  directory: string,
  edit: (lockfile: JsonObject) => void,
): Promise<void> {
  const path = join(directory, "aokit.lock.json");
  const lockfile = parseJsonObject(await readFile(path, "utf8"));
  edit(lockfile);
  await writeFile(path, `${JSON.stringify(lockfile, null, 2)}\n`);
}

test("a directory without a Lockfile is LOCKFILE_MISSING", async () => {
  counter += 1;
  const directory = join(workspace, `empty-${counter}`);
  await mkdir(directory);
  const envelope = await remove(directory, "knip");
  expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
});

test("a malformed Lockfile is LOCKFILE_MISSING", async () => {
  const directory = await createProject();
  await writeFile(join(directory, "aokit.lock.json"), "{ not json");
  const envelope = await remove(directory, "knip");
  expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
});

test("a Module that is not in the Lockfile is NOT_IN_LOCKFILE", async () => {
  const directory = await createProject();
  const envelope = await remove(directory, "tailwind4");
  expect(envelope).toMatchObject({ ok: false, error: { code: "NOT_IN_LOCKFILE" } });
});

test("a locked version the Registry no longer holds is MODULE_VERSION_UNAVAILABLE", async () => {
  const directory = await createProject();
  await editLockfile(directory, (lockfile) => {
    objectAt(lockfile, "modules", "knip")["version"] = "999.0.0";
  });
  const envelope = await remove(directory, "knip");
  expect(envelope).toMatchObject({ ok: false, error: { code: "MODULE_VERSION_UNAVAILABLE" } });
});
