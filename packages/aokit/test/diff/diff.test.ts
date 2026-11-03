import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { appendFile, writeFile } from "node:fs/promises";
import { runCommand } from "../../src/cli/command.ts";
import { diffCommand } from "../../src/cli/commands/diff.ts";
import {
  builtRegistry,
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  editLockfile,
  temporaryDirectory,
} from "./support.ts";

afterEach(cleanTemporaryDirectories);

async function runDiff(directory: string) {
  return runCommand(diffCommand, commandContext, { directory });
}

describe("aokit diff", () => {
  test("a clean Project prints an empty diff", async () => {
    const project = await createProject(await builtRegistry());
    const envelope = await runDiff(project);
    expect(envelope).toEqual({ ok: true, data: { files: [], diff: "" }, error: null });
  });

  test("a locally edited managed file shows a hunk", async () => {
    const project = await createProject(await builtRegistry());
    await appendFile(join(project, "notes.md"), "local edit\n");
    const envelope = await runDiff(project);
    expect(envelope).toMatchObject({
      ok: true,
      data: {
        files: [{ path: "notes.md", hunks: [{ lines: expect.arrayContaining(["+local edit"]) }] }],
        diff: expect.stringContaining("+local edit"),
      },
    });
  });

  test("a seed or ejected file that differs is not listed", async () => {
    const project = await createProject(await builtRegistry());
    await editLockfile(project, (lockfile) => {
      lockfile["files"]["notes.md"].mode = "seed";
    });
    await writeFile(join(project, "notes.md"), "mine\n");
    const seed = await runDiff(project);
    expect(seed).toMatchObject({ ok: true, data: { files: [] } });
    await editLockfile(project, (lockfile) => {
      lockfile["files"]["notes.md"].mode = "ejected";
    });
    const ejected = await runDiff(project);
    expect(ejected).toMatchObject({ ok: true, data: { files: [] } });
  });

  test("a missing managed file is reported as missing", async () => {
    const project = await createProject(await builtRegistry());
    await Bun.file(join(project, "notes.md")).delete();
    const envelope = await runDiff(project);
    expect(envelope).toMatchObject({
      ok: true,
      data: { files: [{ path: "notes.md", status: "missing" }] },
    });
  });

  test("a directory without a Lockfile fails with LOCKFILE_MISSING", async () => {
    const envelope = await runDiff(await temporaryDirectory());
    expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
  });

  test("a URL Registry source is invalid input", async () => {
    const project = await createProject(await builtRegistry());
    await editLockfile(project, (lockfile) => {
      lockfile["registries"]["official"].source = "https://example.com/registry";
    });
    const envelope = await runDiff(project);
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
});
