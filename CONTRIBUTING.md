# Contributing

Thanks for your interest in contributing to aokit! This document covers the conventions this repository expects from a pull request.

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

This repository uses [bun](https://bun.sh) only. Install with `bun install --frozen-lockfile`. Check the `package.json` scripts before running anything, and do not run the build unless asked.

To hide the lint-debt commits from `git blame`, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once (see [.git-blame-ignore-revs](.git-blame-ignore-revs)).

Terms follow [GLOSSARY.md](GLOSSARY.md). The architecture is in [docs/architecture/overview.md](docs/architecture/overview.md) and the coding standards are in [docs/standards](docs/standards/README.md).

## Branch naming and commit format

Work happens on feature branches, never by pushing directly to `main`. Commits and PR titles use Conventional Commits in English with a bullet-point body. Gitmoji is recommended, not required: commitlint accepts both `feat: ✨ add user authentication` and `feat: add user authentication`.

## Merging

Pull requests are merged via **squash merge only**, keeping a linear history. Your commits within a PR don't need to follow the format above individually, but the final PR title does, since it becomes the squashed commit message.

## CI

The CI checks must be green before a pull request can be merged. Run `bun run check` and `bun run test` locally before opening a PR to catch issues early.

## Tests

New functionality and bug fixes must add or update tests in the same PR.

## Decisions

Hard-to-reverse choices get an ADR; see [docs/adr](docs/adr/README.md) and [GOVERNANCE.md](GOVERNANCE.md).

## Reporting security issues

Do not open a public issue for a security vulnerability. Report it privately as described in [`.github/SECURITY.md`](.github/SECURITY.md).
