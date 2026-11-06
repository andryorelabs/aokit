/** Outcome of checking one pushed ref. */
export type PushVerdict = { ok: true } | { ok: false; reason: string };

const zeroSha = /^0+$/;
const conventionalBranch =
  /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ticketBranch = /^ao-\d+(?:-[a-z0-9]+)*$/;
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
