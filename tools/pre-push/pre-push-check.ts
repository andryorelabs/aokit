/** Outcome of checking one pushed ref. */
export type PushVerdict = { ok: true } | { ok: false; reason: string };

const zeroSha = /^0+$/;
const conventionalBranch =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ticketBranch = /^ao-\d+(?:-[a-z0-9]+)+$/;
const renovateBranch = /^renovate\/.+$/;
const branchPrefix = "refs/heads/";

/**
 * Checks one `<local ref> <local sha> <remote ref> <remote sha>` line from the
 * pre-push hook. Tag pushes and branch deletions are skipped.
 */
export function checkPushLine(line: string): PushVerdict {
  const [, localSha, remoteRef] = line.trim().split(/\s+/);
  if (localSha === undefined || remoteRef === undefined) {
    return { ok: true };
  }
  if (!remoteRef.startsWith(branchPrefix) || zeroSha.test(localSha)) {
    return { ok: true };
  }
  const branch = remoteRef.slice(branchPrefix.length);
  if (branch === "main") {
    return {
      ok: false,
      reason: "pushing to main is not allowed; push a feature branch and open a PR",
    };
  }
  if (conventionalBranch.test(branch) || ticketBranch.test(branch) || renovateBranch.test(branch)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `branch "${branch}" must match <type>/<kebab-slug>, ao-<n>-<slug> or renovate/*`,
  };
}

/** Commands the pre-push hook runs, in order, once branch validation passes. */
export const PRE_PUSH_GATES: readonly (readonly string[])[] = [
  ["bun", "run", "typecheck"],
  ["bun", "run", "format:check"],
];

/**
 * True when at least one pushed line updates a branch. Pushes that only delete
 * branches or push tags need no gates.
 */
export function pushNeedsGates(lines: readonly string[]): boolean {
  return lines.some((line) => {
    const [, localSha, remoteRef] = line.trim().split(/\s+/);
    return (
      localSha !== undefined &&
      remoteRef !== undefined &&
      remoteRef.startsWith(branchPrefix) &&
      !zeroSha.test(localSha)
    );
  });
}

/**
 * Runs each gate through `run`, stopping at the first non-zero exit code and
 * returning it. Returns 0 when every gate passes.
 */
export function runGates(
  run: (command: readonly string[]) => number,
  gates: readonly (readonly string[])[] = PRE_PUSH_GATES,
): number {
  for (const command of gates) {
    const exitCode = run(command);
    if (exitCode !== 0) {
      return exitCode;
    }
  }
  return 0;
}

/**
 * Maps a spawned process exit code to a hook exit code. A null code means the
 * process was killed by a signal, which must never let the push through.
 */
export function gateExitCode(exitCode: number | null): number {
  return exitCode === null ? 1 : exitCode;
}
