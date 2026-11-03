import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { runGitChecked } from "../../src/git/run.ts";
import { parseLockfile } from "../../src/lockfile/index.ts";

export const context = { version: cliVersion, env: {}, commands: [] };

export function newWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "aokit-lifecycle-"));
}

export async function createProject(workspace: string, modules = "oxc,vite-react,knip") {
  const directory = join(workspace, `app-${Math.random().toString(36).slice(2)}`);
  const envelope = await runCommand(createCommand, context, {
    directory,
    modules,
    yes: true,
    install: false,
  });
  if (!envelope.ok) {
    throw new Error(envelope.error.message);
  }
  return directory;
}

export function git(cwd: string, ...args: string[]): Promise<string> {
  return runGitChecked(cwd, ["-c", "user.name=t", "-c", "user.email=t@t", ...args]);
}

export async function commitAll(directory: string): Promise<void> {
  await git(directory, "init", "-q");
  await git(directory, "add", "-A");
  await git(directory, "commit", "-q", "-m", "init");
}

export async function readLock(directory: string) {
  return parseLockfile(await readFile(join(directory, "aokit.lock.json"), "utf8")).lockfile;
}

export async function hashOf(directory: string, path: string): Promise<string> {
  const bytes = await readFile(join(directory, path));
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}
