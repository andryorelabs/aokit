import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { restoreCommand } from "../../src/cli/commands/restore.ts";
import { objectAt, parseJsonObject, type JsonObject } from "../helpers/update-json.ts";
import { context, createProject, newWorkspace } from "./helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function restore(directory: string, path: string, extra: Record<string, unknown> = {}) {
  return runCommand(restoreCommand, context, {
    path,
    directory,
    yes: true,
    allowDirty: true,
    ...extra,
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

describe("aokit restore failures", () => {
  test.each(["../outside.txt", "/etc/passwd"])(
    "%s is not a Project-relative path",
    async (path) => {
      const directory = await createProject(workspace, "oxc,knip");
      const envelope = await restore(directory, path);
      expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    },
  );

  test("a directory without a Lockfile is LOCKFILE_MISSING", async () => {
    const directory = join(workspace, "no-project");
    await mkdir(directory, { recursive: true });
    const envelope = await restore(directory, "knip.json");
    expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
  });

  test("a malformed Lockfile is LOCKFILE_MISSING", async () => {
    const directory = await createProject(workspace, "oxc,knip");
    await writeFile(join(directory, "aokit.lock.json"), "{ not json");
    const envelope = await restore(directory, "knip.json");
    expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
  });

  test("a locked file that the Render does not produce is MODULE_VERSION_UNAVAILABLE", async () => {
    const directory = await createProject(workspace, "oxc,knip");
    await editLockfile(directory, (lockfile) => {
      const files = objectAt(lockfile, "files");
      files["ghost.txt"] = { ...objectAt(lockfile, "files", "knip.json") };
    });
    const envelope = await restore(directory, "ghost.txt");
    expect(envelope).toMatchObject({ ok: false, error: { code: "MODULE_VERSION_UNAVAILABLE" } });
  });

  test("a managed path that is a directory fails instead of being overwritten", async () => {
    const directory = await createProject(workspace, "oxc,knip");
    await rm(join(directory, "knip.json"));
    await mkdir(join(directory, "knip.json"));
    const envelope = await restore(directory, "knip.json");
    expect(envelope.ok).toBe(false);
  });

  test("malformed aokit markers in a Region file are INVALID_INPUT", async () => {
    const directory = await createProject(workspace, "oxc,knip");
    await writeFile(join(directory, "AGENTS.md"), "<!-- aokit:begin aokit:header -->\nmine\n");
    const envelope = await restore(directory, "AGENTS.md");
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
});

describe("aokit restore of binary content", () => {
  test("a binary working file is replaced by the text Render", async () => {
    const directory = await createProject(workspace, "oxc,knip");
    const rendered = await readFile(join(directory, "knip.json"), "utf8");
    await writeFile(join(directory, "knip.json"), new Uint8Array([0x00, 0xff, 0x01]));
    const envelope = await restore(directory, "knip.json");
    expect(envelope).toMatchObject({ ok: true, data: { change: "update", applied: true } });
    expect(await readFile(join(directory, "knip.json"), "utf8")).toBe(rendered);
  });

  test("a file that already equals its Render is a no-op", async () => {
    const directory = await createProject(workspace, "oxc,knip");
    const envelope = await restore(directory, "knip.json");
    expect(envelope).toMatchObject({ ok: true, data: { change: "none" } });
  });
});
