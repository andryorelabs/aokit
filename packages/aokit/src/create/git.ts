import { registerShutdownHook } from "../cli/shutdown.ts";

type Environment = Readonly<Record<string, string | undefined>>;

/** The neutral message of the first commit of a new Project. */
export const initialCommitMessage = "chore: initial commit from aokit";

const fallbackIdentity = ["-c", "user.name=aokit", "-c", "user.email=aokit@localhost"];

/** Outcome of {@link initGitRepository}. */
export type GitOutcome =
  | { readonly status: "committed" }
  | { readonly status: "skipped"; readonly warning: string };

interface GitRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function git(
  directory: string,
  env: Environment,
  args: readonly string[],
): Promise<GitRun | undefined> {
  let child;
  try {
    child = Bun.spawn(["git", ...args], {
      cwd: directory,
      env: { ...env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return undefined;
  }
  const unregister = registerShutdownHook(() => {
    child.kill();
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    unregister();
  }
}

function skipped(warning: string): GitOutcome {
  return { status: "skipped", warning };
}

function failure(step: string, run: GitRun | undefined): GitOutcome {
  if (run === undefined) {
    return skipped(`git is not available for \`git ${step}\`; run it yourself`);
  }
  const detail = run.stderr.trim().split("\n").slice(-3).join(" ");
  return skipped(
    `git ${step} failed${detail === "" ? "" : `: ${detail}`}; run \`git init\` and commit yourself`,
  );
}

function succeeded(run: GitRun | undefined): run is GitRun {
  return run !== undefined && run.exitCode === 0;
}

async function identityConfigured(directory: string, env: Environment): Promise<boolean> {
  const [name, email] = await Promise.all([
    git(directory, env, ["config", "user.name"]),
    git(directory, env, ["config", "user.email"]),
  ]);
  return (
    succeeded(name) && name.stdout.trim() !== "" && succeeded(email) && email.stdout.trim() !== ""
  );
}

/**
 * Runs `git init` and makes one initial commit of everything in `directory`. Skips with a warning,
 * never an error, when git is not installed or `directory` is already inside a work tree. A
 * fallback identity applies to the commit only when none is configured; nothing is written to any
 * git config.
 */
export async function initGitRepository(directory: string, env: Environment): Promise<GitOutcome> {
  const probe = await git(directory, env, ["rev-parse", "--is-inside-work-tree"]);
  if (probe === undefined) {
    return skipped("git is not installed; skipped `git init` (pass `--no-git` to silence this)");
  }
  if (probe.exitCode === 0 && probe.stdout.trim() === "true") {
    return skipped("the target is already inside a git work tree; skipped `git init`");
  }
  const initialized = await git(directory, env, ["init"]);
  if (!succeeded(initialized)) {
    return failure("init", initialized);
  }
  const staged = await git(directory, env, ["add", "--all"]);
  if (!succeeded(staged)) {
    return failure("add", staged);
  }
  const identity = (await identityConfigured(directory, env)) ? [] : fallbackIdentity;
  const committed = await git(directory, env, [
    ...identity,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--no-verify",
    "--message",
    initialCommitMessage,
  ]);
  if (!succeeded(committed)) {
    return failure("commit", committed);
  }
  return { status: "committed" };
}
