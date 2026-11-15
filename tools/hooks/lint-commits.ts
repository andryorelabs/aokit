/** Result of one process invocation. */
export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
}

/** Runs git with the given arguments. */
export type GitRunner = (args: readonly string[]) => GitResult;

/** Base ref that pull requests target. */
export const BASE_REF = "origin/develop";

/** Outcome of resolving the commit range to lint. */
export type RangeResult = { ok: true; from: string } | { ok: false; message: string };

/**
 * Resolves the start of the PR range: the merge base of `origin/develop` and `HEAD`.
 * Fails with an actionable message when `origin/develop` is missing.
 */
export function resolveRangeStart(git: GitRunner): RangeResult {
  if (git(["rev-parse", "--verify", "--quiet", `${BASE_REF}^{commit}`]).exitCode !== 0) {
    return {
      ok: false,
      message: `lint:commits: ${BASE_REF} not found; run \`git fetch origin develop\` and retry`,
    };
  }
  const mergeBase = git(["merge-base", BASE_REF, "HEAD"]);
  const from = mergeBase.stdout.trim();
  if (mergeBase.exitCode !== 0 || from === "") {
    return { ok: false, message: `lint:commits: no merge base between ${BASE_REF} and HEAD` };
  }
  return { ok: true, from };
}

/** Builds the commitlint arguments for the range `from..HEAD`. */
export function commitlintArguments(from: string): string[] {
  return ["commitlint", "--from", from, "--to", "HEAD", "--verbose"];
}

/** Runs git in the current directory and captures its output. */
export function runGit(args: readonly string[]): GitResult {
  const result = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
}

/** Collaborators of {@link lintCommits}, injectable for tests. */
export interface LintCommitsDependencies {
  readonly git: GitRunner;
  readonly runCommitlint: (args: readonly string[]) => number;
  readonly writeError: (message: string) => void;
}

/** Lints every commit between the merge base with `origin/develop` and `HEAD`; returns the exit code. */
export function lintCommits(dependencies: LintCommitsDependencies): number {
  const range = resolveRangeStart(dependencies.git);
  if (!range.ok) {
    dependencies.writeError(`${range.message}\n`);
    return 1;
  }
  return dependencies.runCommitlint(commitlintArguments(range.from));
}

/** Runs a locally installed binary through `bun x` and returns its exit code. */
export function runCommitlintProcess(args: readonly string[]): number {
  return Bun.spawnSync(["bun", "x", "--no-install", ...args], {
    stdout: "inherit",
    stderr: "inherit",
  }).exitCode;
}

/** Writes a message to standard error. */
export function writeStderr(message: string): void {
  process.stderr.write(message);
}

/** Real collaborators used when the script runs as a process. */
export const processDependencies: LintCommitsDependencies = {
  git: runGit,
  runCommitlint: runCommitlintProcess,
  writeError: writeStderr,
};

if (import.meta.main) process.exit(lintCommits(processDependencies));
