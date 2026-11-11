import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShutdownHooks } from "../../src/cli/shutdown.ts";
import { initGitRepository } from "../../src/create/git.ts";

const posixShellTest = process.platform === "win32" ? test.skip : test;
const workspaces: string[] = [];

afterAll(() => {
  for (const leftover of workspaces) {
    rmSync(leftover, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-git-spawn-"));
  workspaces.push(directory);
  return directory;
}

function projectDirectory(): string {
  const directory = join(workspace(), "project");
  mkdirSync(directory);
  writeFileSync(join(directory, "a.txt"), "a\n");
  return directory;
}

function shimDirectory(script: string): string {
  const bin = join(workspace(), "bin");
  mkdirSync(bin);
  const shim = join(bin, "git");
  writeFileSync(shim, script);
  chmodSync(shim, 0o755);
  return bin;
}

async function until(condition: () => boolean, deadline = Date.now() + 10_000): Promise<void> {
  if (condition()) return;
  if (Date.now() > deadline) throw new Error("condition was not met in time");
  await Bun.sleep(10);
  await until(condition, deadline);
}

posixShellTest("git that disappears after the probe is reported as unavailable", async () => {
  const bin = shimDirectory(
    [
      "#!/bin/sh",
      'if [ "$1" = "rev-parse" ]; then /bin/rm -f "$0"; exit 128; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  const outcome = await initGitRepository(projectDirectory(), { PATH: bin, HOME: workspace() });
  expect(outcome).toEqual({
    status: "skipped",
    warning: "git is not available for `git init`; run it yourself",
  });
});

posixShellTest("a shutdown hook kills a git process that is still running", async () => {
  const started = join(workspace(), "started");
  const bin = shimDirectory(
    [
      "#!/bin/sh",
      `if [ "$1" = "rev-parse" ]; then : > "${started}"; exec /bin/sleep 30; fi`,
      "exit 0",
      "",
    ].join("\n"),
  );
  const pending = initGitRepository(projectDirectory(), { PATH: bin, HOME: workspace() });
  await until(() => existsSync(started));
  const startedAt = Date.now();
  await runShutdownHooks();
  await pending;
  expect(Date.now() - startedAt).toBeLessThan(10_000);
});
