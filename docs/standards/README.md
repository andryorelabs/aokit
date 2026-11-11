# Standards

Cross-repo standards that aokit's first-party Modules encode and that Andry's own repositories converge on. Each page records current best practice only; legacy repositories are not sources. The research behind them is in [raw notes](../research/raw-notes.md); where the two differ, the [architecture docs](../architecture/overview.md) and the spec win.

## Index

| Page                                            | Covers                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [tooling](tooling.md)                           | Oxc (Oxfmt, Oxlint), the `eslint` companion, git hooks, commit lint, knip, Playwright with axe, the TSDoc-only comments rule. |
| [typescript](typescript.md)                     | TypeScript 6.x plus the `typescript7` alias, explicit bins, `astro check`.                                                    |
| [renovate](renovate.md)                         | Range strategy, release age, automerge, Toolchain pin groups.                                                                 |
| [docs-and-emet](docs-and-emet.md)               | Docs rules, ADRs, `GLOSSARY.md`, `AGENTS.md`, skills, tracker conventions, trunk branch.                                      |
| [repo-settings](repo-settings.md)               | Merge settings, rulesets as code, security features, repository metadata, labels, URLs.                                       |
| [community-and-readme](community-and-readme.md) | Root and `.github` files, issue forms, manifests, the README shape.                                                           |
| [ci-cd](ci-cd.md)                               | Workflow hygiene, the workflow set, runners, tag-driven releases.                                                             |
| [brand](brand.md)                               | Brand kit, names, credit and site hosts.                                                                                      |
| [agent-tooling](agent-tooling.md)               | `emet.config.json`, committed Claude settings, skills lock, ignored agent paths.                                              |
| [testing](testing.md)                           | Coverage threshold policy and the coverage manifest.                                                                          |

The standards map to Modules in the [module catalog](../architecture/module-catalog.md): `oxc`, `eslint` companion, `commitlint` + `husky` + `lint-staged`, `knip`, `playwright` + `axe`, `renovate` and `adr-docs`. Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Fixed premises

- Bun is the only package manager. No standard describes pnpm or npm workflows.
- shadcn is used on Base UI. Tailwind v4 is the styling baseline, with `@shadcn/lint` for shadcn usage.
- Dependencies default to ranges plus a lockfile; only Toolchain pin groups are exact.
- Tooling is a Module choice per Project. A standard describes the default, not a requirement on every Project.
- Python, C++ and Swift are out of scope.

## Adding or revising a standard

1. Open a ticket in the Linear project (see [docs and emet](docs-and-emet.md#linear)) stating the change and the repositories affected.
2. Edit the page. State the rule in one sentence, then the reason, then the Module that encodes it, if any.
3. A change to a rule that a Module encodes updates that Module in the same change, or files a ticket for it.
4. Record a decision that is hard to reverse as an ADR in `docs/adr/`; a revised ADR keeps its number and gains a `Revised:` line rather than being replaced.
5. Merge through a pull request into the repository's trunk branch.

A page changes only when the evidence does: a tool release, a failed parity gate, a repo that found a gap. Preferences without evidence are not enough.

## Redirects

| Old page         | New page                          |
| ---------------- | --------------------------------- |
| `docs-and-forge` | [docs-and-emet](docs-and-emet.md) |

## Sign-off status

Standard v1 was voted on 2026-11-11 by the six repository sessions, and revised on 2026-11-11 to require the promotion of `develop` to `main` by merge commit. Each repo records its adoption and its list of rules that do not apply (N-A) in an ADR. Reported N-A lists:

- aokit: the site footer credit until its site exists, FUNDING, ROADMAP and PRODUCT.
- jobship: `.node-version` where no script runs under Node, the site footer credit, npm publishing, the skills lock, FUNDING and a separate lint-docs workflow.
- snug: FUNDING, npm publishing, plugin manifests and the terminal banner.
- andryore-web: the site footer credit, npm publishing, attestation, plugin manifests and the root `llms.txt`.
- emet and animated-fluent-emojis record theirs in their own ADRs.
