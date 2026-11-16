# Rulesets

The GitHub rulesets of this repository, as code. Each JSON file is the body of one ruleset, in the shape the GitHub rulesets API takes and returns. Rule A4 of [repo settings](../../docs/standards/repo-settings.md) requires them.

| File           | Ruleset                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `develop.json` | `refs/heads/develop`: no deletion, no force push, linear history, signed commits, pull request with squash only and thread resolution, and the required checks with the strict policy. No bypass. |
| `main.json`    | `refs/heads/main`: no deletion, no force push, signed commits, pull request with merge commit only and thread resolution, and the required checks without the strict policy. No bypass.           |
| `tags.json`    | Every tag: no deletion and no update, and only repository admins create one.                                                                                                                      |

`develop` and `main` require `CI passed` and every check of the gating workflows, including each CodeQL `analyze` check.

## How they are checked

- `tools/workflows/rulesets.test.ts` runs in `bun run test`. It fails when a required check is not a real workflow job name, when a gating check or a CodeQL `analyze` check is not required, or when a branch ruleset breaks its merge policy.
- `bun run repo-settings:check` compares these files and [`../repo-settings.json`](../repo-settings.json) with the live repository through `gh api` GET requests. It only reads.

## Change a ruleset

Edit the JSON file in a pull request. After it is promoted to `main`, a repository admin applies it with the commands in [docs/development.md](../../docs/development.md#apply-the-files) and runs `bun run repo-settings:check`.
