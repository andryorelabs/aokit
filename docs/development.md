# Development

How to set up the repository, run its scripts and what the git hooks check. Terms follow [GLOSSARY.md](../GLOSSARY.md). Index: [docs](README.md).

## Setup

1. Install Bun at the version in `packageManager` of `package.json`.
2. Run `bun install --frozen-lockfile` at the root. It installs the workspace and the husky hooks.
3. A fresh git worktree needs the same install.

## Scripts

Run every script from the root with `bun run <script>`.

| Script         | What it does                                                                          |
| -------------- | ------------------------------------------------------------------------------------- |
| `check`        | Typecheck, lint, format check and knip.                                               |
| `test`         | All tests, with the coverage gate.                                                    |
| `fix`          | Formats with Oxfmt, then applies Oxlint fixes.                                        |
| `format:check` | Fails when a file is not formatted.                                                   |
| `format:write` | Formats every file with Oxfmt.                                                        |
| `lint:docs`    | Checks Markdown links.                                                                |
| `lint:commits` | Checks the last commit message with commitlint.                                       |
| `ci:local`     | Runs the frozen install, `check`, `lint:docs`, `test` and `lint:commits`, as CI does. |

Do not run `build:package` or `build:binary` unless a change needs them.

## Git hooks

Husky installs three hooks on `bun install`.

- `pre-commit` runs lint-staged on the staged files.
- `commit-msg` runs commitlint on the message.
- `pre-push` refuses `main` and any branch that does not match `<type>/<kebab-slug>`, `ao-<n>-<slug>`, `worktree-<slug>` or `renovate/*`, then runs `bun run typecheck` and `bun run format:check`.

## Standards

Rules for tooling, TypeScript, dependencies, docs and tests are in [docs/standards](standards/README.md).

## Repository settings

Placeholder: how the repository settings are applied and checked is recorded here.
