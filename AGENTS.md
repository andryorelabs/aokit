# AGENTS.md

Guide for coding agents working in aokit. Terms follow [GLOSSARY.md](GLOSSARY.md).

## Layout

- `packages/aokit/`: the `aokit` CLI and the core, one entry per subsystem. Package rules: [packages/aokit/AGENTS.md](packages/aokit/AGENTS.md).
- `packages/module/`: `@aokit/module`, the Module manifest contract. Package rules: [packages/module/AGENTS.md](packages/module/AGENTS.md).
- `registry-src/`: first-party Module sources. `registry/`: the built Registry (generated, never edited by hand).
- `tools/`: dev-only scripts and invariant tests (lint plugin, docs, workflows, Claude hooks, pre-push).
- `docs/`: architecture, ADRs, standards. Index: [docs/README.md](docs/README.md).
- `docs/agents/`: per-repo `/emet` config prose. Start with [codebase map](docs/agents/codebase.md), [domain vocabulary](docs/agents/domain.md), [emet config](docs/agents/emet.md), [issue tracker](docs/agents/issue-tracker.md) and [triage labels](docs/agents/triage-labels.md).
- Root: dev tooling config.

## Running scripts

Read `package.json` first, then run scripts from the repo root with `bun run <script>`; never call the tools directly.

- `bun run check`: typecheck, lint, format check, knip.
- `bun run test`: all tests.
- `bun run format:write`: format with Oxfmt.
- `bun run fix`: format and apply Oxlint fixes.
- `bun run ci:local`: frozen install, `check`, `lint:docs`, `test` and `lint:commits`, as CI runs them.
- `bun run lint:docs` and `bun run lint:package`: docs link check and package lint.
- build: do not run `build:package` or `build:binary` unless explicitly asked.

## Rules

- Bun only; never mix package managers. See [ADR-0006](docs/adr/0006-bun-only.md).
- Never loosen a tsconfig or lint setting to pass a check; fix the code. See [ADR-0008](docs/adr/0008-oxc-default-with-eslint-companion.md).
- The repo configures Oxlint in `oxlint.config.ts` and Knip in `knip.jsonc`; generated Projects keep JSON. See [ADR-0022](docs/adr/0022-repo-lint-config-is-typescript.md).
- Generation is deterministic and writes are atomic. See [ADR-0012](docs/adr/0012-deterministic-generation-and-atomic-writes.md).
- No telemetry in v1. See [ADR-0013](docs/adr/0013-no-telemetry-in-v1.md).
- One Zod schema drives CLI, prompts and MCP. See [ADR-0009](docs/adr/0009-one-zod-schema-for-all-interfaces.md).
- Coverage: add tests instead of lowering the threshold; raise it when coverage rises.

## ADRs

Decisions live in [docs/adr/](docs/adr/README.md). Read those touching your area before changing it, and flag a contradiction instead of overriding it. Add an ADR as `docs/adr/NNNN-kebab-title.md` with a row in the index; `bun run test` fails if they disagree. Standards are in [docs/standards](docs/standards/README.md).

## Branch and commit conventions

- Feature branches always; never push to `main`. A pre-push hook refuses `main` and branch names that are not `<type>/<kebab-slug>`, `ao-<n>-<slug>`, `worktree-<slug>` or `renovate/*`, then runs `bun run typecheck` and `bun run format:check`.
- PRs squash into `main`. Worker branches are `ao-<n>-<slug>`.
- Commits are gitmoji + conventional, in English, with a bullet body: `feat: ✨ add user authentication`.
- A ticket's commit body ends with `Refs: AO-<n>`.
- PR titles use the same conventional types as commitlint.
- Contributor-facing rules: [CONTRIBUTING.md](CONTRIBUTING.md).

## Code comments

TSDoc only (`/** */`). No `//` comments, except tool directives (`oxlint-disable`, `@ts-expect-error`), which need ` -- reason`.

## Quirks

- Typecheck with the aliased `typescript7` by path, never bare `tsc`; `bun run typecheck` does this.
- `.claude/settings.json` registers a guard that auto-approves only a plain `rm` of literal paths inside the repo or the temp dir; everything else prompts.
- A fresh worktree needs `bun install --frozen-lockfile` at the root.
