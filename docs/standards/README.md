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
| [product-types](product-types.md)               | CLI, plugin, site and bilingual rules.                                                                                        |

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

## Levels and project types

Standard v2 adds the rules V01 to V44. Each page states a v2 rule as `**<ID>** (V<nn>, <level>, <types>)`, so every V number appears once, in the page that owns it, under an ID that continues that page's letter series (A to H, and I for the new product types page). A rule marked with two levels, such as "must rel, should all", is a must for the first type and a should for the rest.

| Word        | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| all         | every repository                                     |
| rel         | a repository that publishes releases                 |
| bin         | a repository that ships compiled binaries            |
| lib         | a repository that publishes a package                |
| CLI, plugin | a command line tool, a Claude Code plugin            |
| site        | a product site (UI: a project with a user interface) |
| mono        | a monorepo with several workspaces                   |
| TS          | a TypeScript repository                              |
| bilingual   | a repository with more than one language             |
| E2E         | a repository with an end-to-end suite                |

### Rule index

| V   | ID  | Page                                            | V   | ID     | Page                              |
| --- | --- | ----------------------------------------------- | --- | ------ | --------------------------------- |
| V01 | D6  | [docs-and-emet](docs-and-emet.md)               | V23 | E17    | [tooling](tooling.md)             |
| V02 | D7  | [docs-and-emet](docs-and-emet.md)               | V24 | E18    | [tooling](tooling.md)             |
| V03 | D8  | [docs-and-emet](docs-and-emet.md)               | V25 | E3, E9 | [testing](testing.md)             |
| V04 | D9  | [docs-and-emet](docs-and-emet.md)               | V26 | E19    | [testing](testing.md)             |
| V05 | D10 | [docs-and-emet](docs-and-emet.md)               | V27 | E20    | [testing](testing.md)             |
| V06 | D11 | [docs-and-emet](docs-and-emet.md)               | V28 | F6     | [ci-cd](ci-cd.md)                 |
| V07 | D12 | [docs-and-emet](docs-and-emet.md)               | V29 | F7     | [ci-cd](ci-cd.md)                 |
| V08 | B8  | [community-and-readme](community-and-readme.md) | V30 | F8     | [ci-cd](ci-cd.md)                 |
| V09 | B9  | [community-and-readme](community-and-readme.md) | V31 | F9     | [ci-cd](ci-cd.md)                 |
| V10 | B10 | [community-and-readme](community-and-readme.md) | V32 | F10    | [ci-cd](ci-cd.md)                 |
| V11 | D13 | [docs-and-emet](docs-and-emet.md)               | V33 | F11    | [ci-cd](ci-cd.md)                 |
| V12 | A11 | [repo-settings](repo-settings.md)               | V34 | F12    | [ci-cd](ci-cd.md)                 |
| V13 | A12 | [repo-settings](repo-settings.md)               | V35 | F13    | [ci-cd](ci-cd.md)                 |
| V14 | B11 | [community-and-readme](community-and-readme.md) | V36 | F14    | [ci-cd](ci-cd.md)                 |
| V15 | B12 | [community-and-readme](community-and-readme.md) | V37 | F15    | [ci-cd](ci-cd.md)                 |
| V16 | E10 | [tooling](tooling.md)                           | V38 | F16    | [ci-cd](ci-cd.md)                 |
| V17 | E11 | [tooling](tooling.md)                           | V39 | I1, I2 | [product-types](product-types.md) |
| V18 | E12 | [tooling](tooling.md)                           | V40 | I3     | [product-types](product-types.md) |
| V19 | E13 | [tooling](tooling.md)                           | V41 | I4     | [product-types](product-types.md) |
| V20 | E14 | [tooling](tooling.md)                           | V42 | I5     | [product-types](product-types.md) |
| V21 | E15 | [tooling](tooling.md)                           | V43 | H5     | [agent-tooling](agent-tooling.md) |
| V22 | E16 | [tooling](tooling.md)                           | V44 | H6     | [agent-tooling](agent-tooling.md) |

V45 listed defects in the v1 text; they are fixed in place (the README sign-off, G3, H1, and the aokit-only markers).

## Sign-off status

Standard v1 was voted on 2026-11-11 by the six repository sessions, and revised on 2026-11-11 to require the promotion of `develop` to `main` by merge commit. Standard v2 was agreed on 2026-11-15 by the same sessions. Each repo records its adoption and its list of rules that do not apply (N-A) in an ADR; the lists live only there, so they cannot drift from this page.

- [aokit: ADR 0029](../adr/0029-adopt-cross-repo-standard-v1.md)
- [emet: ADR 0024](https://github.com/andryorelabs/emet/blob/main/docs/adr/0024-adopt-the-andryorelabs-standard.md)
- [jobship: ADR 0007](https://github.com/andryorelabs/jobship/blob/main/docs/adr/0007-adopt-cross-repo-standard-v1.md)
- [snug: ADR 0035](https://github.com/andryorelabs/snug/blob/main/docs/adr/0035-adopt-andryorelabs-standard-v1.md)
- [animated-fluent-emojis: ADR 0029](https://github.com/andryorelabs/animated-fluent-emojis/blob/main/docs/adr/0029-andryorelabs-cross-repo-standard.md)
- [andryore-web: ADR 0025](https://github.com/andryorelabs/andryore-web/blob/main/docs/adr/0025-adopt-cross-repo-standard-v1.md)
