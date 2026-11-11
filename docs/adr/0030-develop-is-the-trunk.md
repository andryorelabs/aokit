# 0030. develop is the trunk

Status: Accepted (2026-11-11)
Spec: S1 to S6 (Develop trunk spec)
Architecture: [Repo settings](../standards/repo-settings.md)

## Context

All work landed on `main`, which is also the branch a CLI version is tagged on. A candidate for the next CLI version had no place to accumulate and be verified before it reached the branch users install from. The sibling repositories emet, jobship and andryore-web already work on a `develop` trunk. The [repo settings](../standards/repo-settings.md) standard allows a `develop` ruleset next to `main` and `tags` (rule A4) and keeps merge commits for a repository that promotes `develop` to `main` (rule A1).

## Decision

- `develop` is the development branch and the `/emet` trunk. Feature branches, `/emet` wave pull requests and Renovate pull requests target `develop` and are squash-merged, so `develop` stays linear.
- A promotion is a pull request from `develop` to `main`, merged with a merge commit. `main` holds promoted history only.
- A CLI version is still tagged on `main`: the bump pull request lands on `develop`, a promotion follows, and the tag is cut on the promotion merge commit. The release workflow still requires the tagged commit to be on `main` with "CI passed" green.
- `main` stays the default branch, so installs and the README read promoted history.
- Rulesets live as code in `.github/rulesets/`: `develop` (squash only, linear history, required checks with the up to date policy, signed commits), `main` (merge commits only, required checks, signed commits) and `tags`. `main` drops linear history and the up to date policy, because a merge commit on `main` is never on `develop`.
- The repository allows squash and merge commits; each ruleset decides which method its branch accepts.
- Every workflow that runs on a push to `main` also runs on a push to `develop`, except the OpenSSF Scorecard, which reads the default branch.
- The `pre-push` hook and the agent deny list refuse a push to `main` or to `develop`.
- `emet.config.json` sets `repo.trunk` to `develop`.
- The rules that [ADR-0029](0029-adopt-cross-repo-standard-v1.md) adopted for the trunk now apply to `develop`.

## Consequences

- Two long-lived branches need a promotion to stay in step. `main` carries merge commits that `develop` lacks.
- Renaming a required job in a workflow means updating both branch rulesets in the same change, or `bun run test` fails.
- A `Closes #N` line no longer closes a GitHub issue on merge, because `develop` is not the default branch. Tickets live in Linear, whose GitHub integration follows the pull request, not the default branch.
- The `github-ci` Module is unchanged: a generated Project chooses its own trunk at `create`.

## Alternatives considered

- Keep `main` as the trunk: there is no verification point before a CLI version is tagged, and aokit stays different from its siblings.
- Squash `develop` into `main`: squashing breaks the relationship between the two branches and causes repeated conflicts on later promotions.
- Make `develop` the default branch: installs and the README would then read unpromoted history.
