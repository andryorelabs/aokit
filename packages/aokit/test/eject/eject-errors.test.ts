import { afterAll, expect, test } from "bun:test";
import { chmod, rm } from "node:fs/promises";
import { runCommand } from "../../src/cli/command.ts";
import { ejectCommand } from "../../src/cli/commands/eject.ts";
import { commitAll, context, createProject, newWorkspace } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test("eject reports a failure to write the Lockfile", async () => {
  const directory = await createProject(workspace);
  await commitAll(directory);
  await chmod(directory, 0o555);
  try {
    const envelope = await runCommand(ejectCommand, context, { path: "src/main.tsx", directory });
    expect(envelope.ok).toBe(false);
  } finally {
    await chmod(directory, 0o755);
  }
});
