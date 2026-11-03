# Standards

Cross-repo standards that aokit's first-party Modules encode and that Andry's own repositories converge on. Each page records current best practice only; legacy repositories are not sources. The research behind them is in [raw notes](../research/raw-notes.md); where the two differ, the [architecture docs](../architecture/overview.md) and the spec win.

## Index

| Page | Covers |
| --- | --- |
| [tooling](tooling.md) | Oxc (Oxfmt, Oxlint), the `eslint` companion, git hooks, commit lint, knip, Playwright with axe, the TSDoc-only comments rule. |
| [typescript](typescript.md) | TypeScript 6.x plus the `typescript7` alias, explicit bins, `astro check`. |
| [renovate](renovate.md) | Range strategy, release age, automerge, Toolchain pin groups. |
| [docs-and-forge](docs-and-forge.md) | ADRs, `CONTEXT.md`, `AGENTS.md`, skills, Linear conventions, trunk branch. |

The standards map to Modules in the [module catalog](../architecture/module-catalog.md): `oxc`, `eslint` companion, `commitlint` + `husky` + `lint-staged`, `knip`, `playwright` + `axe`, `renovate` and `adr-docs`. Terms follow [CONTEXT.md](../../CONTEXT.md).

## Fixed premises

- Bun is the only package manager. No standard describes pnpm or npm workflows.
- shadcn is used on Base UI. Tailwind v4 is the styling baseline, with `@shadcn/lint` for shadcn usage.
- Dependencies default to ranges plus a lockfile; only Toolchain pin groups are exact.
- Tooling is a Module choice per Project. A standard describes the default, not a requirement on every Project.
- Python, C++ and Swift are out of scope.

## Adding or revising a standard

1. Open a ticket in the Linear project (see [docs and forge](docs-and-forge.md#linear)) stating the change and the repositories affected.
2. Edit the page. State the rule in one sentence, then the reason, then the Module that encodes it, if any.
3. A change to a rule that a Module encodes updates that Module in the same change, or files a ticket for it.
4. Record a decision that is hard to reverse as an ADR in `docs/adr/`; a revised ADR keeps its number and gains a `Revised:` line rather than being replaced.
5. Merge through a pull request into the repository's trunk branch.

A page changes only when the evidence does: a tool release, a failed parity gate, a repo that found a gap. Preferences without evidence are not enough.

## Sign-off status

These standards were agreed across four repository sessions (aokit, andryore-web, snug and animated-fluent-emojis) and were checked against the wider repo audit. Sign-off from the other repositories' own sessions is **pending** for every item outside aokit: rules that apply to a repo other than aokit are recommendations until that repo's own session adopts them. Items that stay open are also repo-specific by design (trunk branch, test runner, whether to enforce gitmoji, whether to use the content mapper).
