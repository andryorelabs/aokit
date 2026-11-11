# Development

How to set up the repository, run its scripts and what the git hooks check. Terms follow [GLOSSARY.md](../GLOSSARY.md). Index: [docs](README.md).

## Setup

1. Install Bun at the version in `packageManager` of `package.json`.
2. Run `bun install --frozen-lockfile` at the root. It installs the workspace and the husky hooks.
3. A fresh git worktree needs the same install.

## Scripts

Run every script from the root with `bun run <script>`.

| Script                | What it does                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `check`               | Typecheck, lint, format check and knip.                                                            |
| `test`                | All tests, with the coverage gate.                                                                 |
| `fix`                 | Formats with Oxfmt, then applies Oxlint fixes.                                                     |
| `format:check`        | Fails when a file is not formatted.                                                                |
| `format:write`        | Formats every file with Oxfmt.                                                                     |
| `lint:docs`           | Checks Markdown links.                                                                             |
| `lint:commits`        | Checks the last commit message with commitlint.                                                    |
| `ci:local`            | Runs the frozen install, `check`, `lint:docs`, `test` and `lint:commits`, as CI does.              |
| `repo-settings:check` | Compares the live GitHub settings with the files. See [Repository settings](#repository-settings). |

Do not run `build:package` or `build:binary` unless a change needs them.

## Git hooks

Husky installs three hooks on `bun install`.

- `pre-commit` runs lint-staged on the staged files.
- `commit-msg` runs commitlint on the message.
- `pre-push` refuses `main`, `develop` and any branch that does not match `<type>/<kebab-slug>`, `ao-<n>-<slug>`, `worktree-<slug>` or `renovate/*`, then runs `bun run typecheck` and `bun run format:check`.

## Standards

Rules for tooling, TypeScript, dependencies, docs and tests are in [docs/standards](standards/README.md).

## Repository settings

GitHub settings live as code, as rules A1 to A8 of [repo settings](standards/repo-settings.md) require.

| File                            | What it holds                                                                                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/settings.json`         | `repository`: merge options, features, description, homepage and topics. `security`: secret scanning, push protection, Dependabot and private vulnerability reporting. |
| `.github/rulesets/main.json`    | The ruleset for `main`.                                                                                                                                                |
| `.github/rulesets/develop.json` | The ruleset for `develop`.                                                                                                                                             |
| `.github/rulesets/tags.json`    | The ruleset for tags.                                                                                                                                                  |

### Check for drift

```sh
bun run repo-settings:check
```

The script reads the live repository with `gh api` GET requests and compares it with the files. It never writes. It exits 0 when they match. On drift it exits 1 and prints each setting with its expected and live value. It also exits 1, with the reason, when `gh` is missing or not authenticated. Sign in to `gh` as a repository admin, because GitHub hides the security settings from other users. The script is not part of `bun run test` or CI.

### Apply the files

Applying is a manual step for a repository admin, after the change to the files merges into `develop` and is promoted to `main`. Run the commands from the root, then run the check.

Repository options and topics:

```sh
jq '.repository | del(.topics)' .github/settings.json | gh api -X PATCH repos/andryorelabs/aokit --input -
jq '{names: .repository.topics}' .github/settings.json | gh api -X PUT repos/andryorelabs/aokit/topics --input -
```

Security features, all on in `security`:

```sh
gh api -X PATCH repos/andryorelabs/aokit --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
gh api -X PUT repos/andryorelabs/aokit/vulnerability-alerts
gh api -X PUT repos/andryorelabs/aokit/automated-security-fixes
gh api -X PUT repos/andryorelabs/aokit/private-vulnerability-reporting
```

Rulesets, one `PUT` per file with the id of the live ruleset of the same name:

```sh
gh api repos/andryorelabs/aokit/rulesets --jq '.[] | "\(.id) \(.name)"'
gh api -X PUT repos/andryorelabs/aokit/rulesets/<main id> --input .github/rulesets/main.json
gh api -X PUT repos/andryorelabs/aokit/rulesets/<develop id> --input .github/rulesets/develop.json
gh api -X PUT repos/andryorelabs/aokit/rulesets/<tags id> --input .github/rulesets/tags.json
```

Create a ruleset that does not exist yet with `gh api -X POST repos/andryorelabs/aokit/rulesets --input <file>`.

`develop` and `main` require signed commits. GitHub signs the squash commit and the merge commit of a merged pull request, so merging needs no local signing key.

`develop` is the trunk: pull requests target it and are squash-merged. A promotion pull request from `develop` to `main` is merged with a merge commit, and a CLI version is tagged on the promotion merge commit on `main`. See [ADR-0030](adr/0030-develop-is-the-trunk.md).
