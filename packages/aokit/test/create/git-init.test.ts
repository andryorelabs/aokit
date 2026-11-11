import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initGitRepository, type GitOutcome } from "../../src/create/git.ts";

const posixShellTest = process.platform === "win32" ? test.skip : test;
const workspaces: string[] = [];

afterAll(() => {
  for (const leftover of workspaces) {
    rmSync(leftover, { recursive: true, force: true });
  }
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "aokit-git-init-"));
  workspaces.push(directory);
  return directory;
}

function projectWithFile(): string {
  const directory = join(workspace(), "project");
  mkdirSync(directory);
  writeFileSync(join(directory, "a.txt"), "a\n");
  return directory;
}

function warningOf(outcome: GitOutcome): string {
  return outcome.status === "skipped" ? outcome.warning : "";
}

function cleanGitEnvironment(home: string): Record<string, string | undefined> {
  return {
    PATH: process.env["PATH"],
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

/** A PATH whose `git` fails on `failingSubcommand` with a message, and succeeds otherwise. */
function failingGit(failingSubcommand: string): Record<string, string | undefined> {
  const bin = join(workspace(), "bin");
  mkdirSync(bin);
  const script = join(bin, "git");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      'for argument in "$@"; do',
      `  if [ "$argument" = "${failingSubcommand}" ]; then echo "boom ${failingSubcommand}" >&2; exit 3; fi`,
      "done",
      'if [ "$1" = "rev-parse" ]; then exit 128; fi',
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return { PATH: `${bin}:${process.env["PATH"] ?? ""}`, HOME: workspace() };
}

describe("initGitRepository", () => {
  posixShellTest("commits with a fallback identity when none is configured", async () => {
    const directory = projectWithFile();
    const outcome = await initGitRepository(directory, cleanGitEnvironment(workspace()));
    expect(outcome).toEqual({ status: "committed" });
  });

  posixShellTest("skips when the target is already inside a work tree", async () => {
    const directory = projectWithFile();
    const environment = cleanGitEnvironment(workspace());
    await initGitRepository(directory, environment);
    const outcome = await initGitRepository(directory, environment);
    expect(warningOf(outcome)).toContain("already inside a git work tree");
  });

  test("skips with a warning when git is not installed", async () => {
    const outcome = await initGitRepository(projectWithFile(), { PATH: workspace() });
    expect(warningOf(outcome)).toContain("git is not installed");
  });

  posixShellTest("skips with the failing step and its stderr when init fails", async () => {
    const outcome = await initGitRepository(projectWithFile(), failingGit("init"));
    expect(warningOf(outcome)).toMatch(/git init failed: boom init/);
  });

  posixShellTest("skips when staging fails", async () => {
    const outcome = await initGitRepository(projectWithFile(), failingGit("add"));
    expect(warningOf(outcome)).toContain("git add failed");
  });

  posixShellTest("skips when the commit fails", async () => {
    const outcome = await initGitRepository(projectWithFile(), failingGit("commit"));
    expect(warningOf(outcome)).toContain("git commit failed");
  });
});
