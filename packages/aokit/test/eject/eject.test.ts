import { afterAll, expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { ejectCommand } from "../../src/cli/commands/eject.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import {
  commitAll,
  context,
  createProject,
  git,
  hashOf,
  newWorkspace,
  readLock,
} from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test("eject marks the entry ejected, keeps owners and hash, and changes only the Lockfile", async () => {
  const directory = await createProject(workspace);
  await commitAll(directory);
  const before = (await readLock(directory)).files["src/main.tsx"];
  const envelope = await runCommand(ejectCommand, context, { path: "src/main.tsx", directory });
  expect(envelope.ok).toBe(true);
  expect((await git(directory, "status", "--porcelain")).trim()).toBe("M aokit.lock.json");
  const after = (await readLock(directory)).files["src/main.tsx"];
  expect(after).toEqual({ ...before!, mode: "ejected" });
  expect(after?.hash).toBe(await hashOf(directory, "src/main.tsx"));
});

test("eject needs no clean tree and also works on seed files", async () => {
  const directory = await createProject(workspace);
  await commitAll(directory);
  const lockfile = await readLock(directory);
  const seed = Object.entries(lockfile.files).find(([, entry]) => entry.mode === "seed");
  await writeFile(join(directory, "scratch.txt"), "dirty\n");
  const path = seed?.[0] ?? "src/main.tsx";
  const envelope = await runCommand(ejectCommand, context, { path, directory });
  expect(envelope.ok).toBe(true);
  expect((await readLock(directory)).files[path]?.mode).toBe("ejected");
  expect(await readFile(join(directory, "scratch.txt"), "utf8")).toBe("dirty\n");
});

test("eject fails with NOT_IN_LOCKFILE (exit 3) for an unknown path", async () => {
  const directory = await createProject(workspace);
  const envelope = await runCommand(ejectCommand, context, { path: "nope.txt", directory });
  expect(envelope.ok).toBe(false);
  if (!envelope.ok) {
    expect(envelope.error.code).toBe("NOT_IN_LOCKFILE");
    expect(exitCodeForErrorCode(envelope.error.code)).toBe(3);
  }
});
