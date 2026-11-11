import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { checkCommand } from "../../src/cli/commands/check.ts";
import {
  builtRegistry,
  cleanTemporaryDirectories,
  commandContext,
  createProject,
  temporaryDirectory,
} from "../diff/support.ts";

afterEach(cleanTemporaryDirectories);

describe("aokit check failures", () => {
  test("a directory without a Lockfile fails with LOCKFILE_MISSING", async () => {
    const directory = await temporaryDirectory();
    const envelope = await runCommand(checkCommand, commandContext, { directory });
    expect(envelope).toMatchObject({ ok: false, error: { code: "LOCKFILE_MISSING" } });
  });

  test("an unparsable Lockfile fails with INVALID_INPUT", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "aokit.lock.json"), "not json", "utf8");
    const envelope = await runCommand(checkCommand, commandContext, { directory });
    expect(envelope).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  test("a Lockfile path that is a directory surfaces the read failure", async () => {
    const directory = await temporaryDirectory();
    await mkdir(join(directory, "aokit.lock.json"));
    const envelope = await runCommand(checkCommand, commandContext, { directory });
    expect(envelope.ok).toBe(false);
  });

  test("a Registry that needs a newer CLI fails with MIN_CLI_VERSION", async () => {
    const project = await createProject(await builtRegistry());
    const envelope = await runCommand(
      checkCommand,
      { ...commandContext, version: "0.0.0" },
      { directory: project },
    );
    expect(envelope).toMatchObject({ ok: false, error: { code: "MIN_CLI_VERSION" } });
  });

  test("a removed Project directory is not an aokit Project", async () => {
    const directory = await temporaryDirectory();
    await rm(directory, { recursive: true, force: true });
    const envelope = await runCommand(checkCommand, commandContext, { directory });
    expect(envelope.ok).toBe(false);
  });
});
