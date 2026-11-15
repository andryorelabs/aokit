import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  commitlintArguments,
  lintCommits,
  processDependencies,
  resolveRangeStart,
  runCommitlintProcess,
  runGit,
  writeStderr,
  type GitRunner,
} from "./lint-commits.ts";

function runnerFor(responses: Record<string, { exitCode: number; stdout: string }>): GitRunner {
  return (args) => responses[args[0] ?? ""] ?? { exitCode: 1, stdout: "" };
}

describe("resolveRangeStart", () => {
  test("fails with a fetch hint when origin/develop is missing", () => {
    const result = resolveRangeStart(runnerFor({ "rev-parse": { exitCode: 1, stdout: "" } }));
    expect(result).toEqual({
      ok: false,
      message: "lint:commits: origin/develop not found; run `git fetch origin develop` and retry",
    });
  });

  test("returns the merge base when origin/develop exists", () => {
    const result = resolveRangeStart(
      runnerFor({
        "rev-parse": { exitCode: 0, stdout: "abc\n" },
        "merge-base": { exitCode: 0, stdout: "def456\n" },
      }),
    );
    expect(result).toEqual({ ok: true, from: "def456" });
  });

  test("fails when there is no merge base", () => {
    const result = resolveRangeStart(
      runnerFor({
        "rev-parse": { exitCode: 0, stdout: "abc\n" },
        "merge-base": { exitCode: 1, stdout: "" },
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("lintCommits", () => {
  test("reports the missing base and skips commitlint", () => {
    const errors: string[] = [];
    let ran = false;
    const code = lintCommits({
      git: () => ({ exitCode: 1, stdout: "" }),
      runCommitlint: () => {
        ran = true;
        return 0;
      },
      writeError: (message) => errors.push(message),
    });
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(errors.join("")).toContain("origin/develop not found");
  });

  test("passes the range to commitlint and returns its exit code", () => {
    let received: readonly string[] = [];
    const code = lintCommits({
      git: () => ({ exitCode: 0, stdout: "base\n" }),
      runCommitlint: (args) => {
        received = args;
        return 3;
      },
      writeError: () => undefined,
    });
    expect(code).toBe(3);
    expect(received).toEqual(commitlintArguments("base"));
  });

  test("lints an explicit --from and --to range without asking git for a merge base", () => {
    let received: readonly string[] = [];
    let askedGit = false;
    const code = lintCommits(
      {
        git: () => {
          askedGit = true;
          return { exitCode: 1, stdout: "" };
        },
        runCommitlint: (args) => {
          received = args;
          return 0;
        },
        writeError: () => undefined,
      },
      ["--from", "base123", "--to", "head456"],
    );
    expect(code).toBe(0);
    expect(askedGit).toBe(false);
    expect(received).toEqual(commitlintArguments("base123", "head456"));
  });

  test.each([
    [["--from", "base123"]],
    [["--to", "head456"]],
    [["--from", "--to", "head456"]],
    [["--verbose"]],
  ])("rejects the arguments %j without running commitlint", (argv) => {
    const errors: string[] = [];
    let ran = false;
    const code = lintCommits(
      {
        git: () => ({ exitCode: 0, stdout: "base\n" }),
        runCommitlint: () => {
          ran = true;
          return 0;
        },
        writeError: (message) => errors.push(message),
      },
      argv,
    );
    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(errors.join("")).toContain("lint:commits: pass both --from <ref> and --to <ref>");
  });
});

describe("runGit", () => {
  test("captures git output and exit code", () => {
    const result = runGit(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("git version");
  });
});

describe("process dependencies", () => {
  test("wire the real runners and an empty stderr write", () => {
    expect(processDependencies.git).toBe(runGit);
    expect(processDependencies.runCommitlint).toBe(runCommitlintProcess);
    expect(processDependencies.writeError).toBe(writeStderr);
    expect(() => {
      writeStderr("");
    }).not.toThrow();
  });
});

describe("runCommitlintProcess", () => {
  test("returns the exit code of the installed commitlint", () => {
    expect(runCommitlintProcess(["commitlint", "--version"])).toBe(0);
  });
});

describe("commitlintArguments", () => {
  test("lints from the merge base to HEAD", () => {
    expect(commitlintArguments("def456")).toEqual([
      "commitlint",
      "--from",
      "def456",
      "--to",
      "HEAD",
      "--verbose",
    ]);
  });

  test("lints an explicit range up to the given ref", () => {
    expect(commitlintArguments("def456", "abc123")).toEqual([
      "commitlint",
      "--from",
      "def456",
      "--to",
      "abc123",
      "--verbose",
    ]);
  });
});

const repositoryRoot = resolve(import.meta.dir, "../..");

function gitIn(directory: string, args: readonly string[]): string {
  const result = Bun.spawnSync(
    [
      "git",
      "-C",
      directory,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  return result.stdout.toString();
}

describe("lintCommits against a real repository", () => {
  test("fails when an older commit in the range has a bad message and the newest is good", () => {
    const directory = mkdtempSync(join(tmpdir(), "lint-commits-"));
    try {
      gitIn(directory, ["init", "--quiet", "--initial-branch=develop"]);
      gitIn(directory, ["commit", "--allow-empty", "--quiet", "-m", "chore: 🔧 base"]);
      gitIn(directory, ["update-ref", "refs/remotes/origin/develop", "HEAD"]);
      gitIn(directory, ["checkout", "--quiet", "-b", "feature"]);
      gitIn(directory, ["commit", "--allow-empty", "--quiet", "-m", "bad message"]);
      gitIn(directory, ["commit", "--allow-empty", "--quiet", "-m", "chore: 🔧 good message"]);
      const code = lintCommits({
        git: (args) => ({
          exitCode: Bun.spawnSync(["git", "-C", directory, ...args]).exitCode,
          stdout: gitIn(directory, args),
        }),
        runCommitlint: (args) =>
          Bun.spawnSync(
            [
              "bun",
              "x",
              "--no-install",
              ...args.slice(0, 1),
              "--cwd",
              directory,
              "--config",
              join(repositoryRoot, "commitlint.config.ts"),
              ...args.slice(1),
            ],
            { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
          ).exitCode,
        writeError: () => undefined,
      });
      expect(code).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
