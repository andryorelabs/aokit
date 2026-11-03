/** Outcome of one `git` invocation. */
export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git` with `args` in `cwd`, feeding `stdin` when given. Never throws on a non-zero exit. */
export async function runGit(
  cwd: string,
  args: readonly string[],
  stdin?: string,
): Promise<GitResult> {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** Runs `git` and returns stdout, throwing an `Error` with git's stderr on a non-zero exit. */
export async function runGitChecked(
  cwd: string,
  args: readonly string[],
  stdin?: string,
): Promise<string> {
  const result = await runGit(cwd, args, stdin);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}
