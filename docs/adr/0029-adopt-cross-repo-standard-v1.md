# 0029. aokit adopts the cross-repo standard v1

Status: Accepted (2026-11-11)
Revised: 2026-11-11 — the branch model is a must: `develop` is promoted to `main` by merge commit
Revised: 2026-11-15 — aokit adopts standard v2 (rules V01 to V44, IDs continuing each standards page), with its own N-A list and the deferred site, `install.sh` and plugin work
Spec: S1 to S8 (Standard v1 spec)
Architecture: [Standards](../standards/README.md)

## Context

Andry's six public repositories (aokit, emet, jobship, snug, animated-fluent-emojis and andryore-web) drifted apart in GitHub settings, community files, README shape, script names, release flow and agent tooling. The [standards](../standards/README.md) covered tooling, TypeScript, Renovate, docs and testing only, and their sign-off outside aokit was pending.

On 2026-11-11 one session per repository audited all six, exchanged inventories and voted a numbered rule set, "standard v1", rule by rule. Every session confirmed the final text.

## Decision

- aokit adopts standard v1. Rules are identified by letter and number: A (repository settings), B (community files), C (README), D (docs), E (code quality), F (CI and release), G (brand) and H (agent tooling).
- The technical rules live in [docs/standards](../standards/README.md) in this repository, which every other repository links to. The public brand rules live in the [andryore-web brand README](https://github.com/andryorelabs/andryore-web/blob/main/docs/brand/README.md).
- Each repository closes its own gaps and records its adoption in an ADR of its own. No repository session edits another repository.
- Repository settings and rulesets are files under `.github/`, and a script reports any difference from the live repository. The live settings are applied from the files, never edited by hand first.
- A rule changes through the process in the standards README, with a ticket and a pull request here.

Rules that do not apply to aokit:

- G3, site footer credit: aokit has no product site yet. It applies once `aokit.andryore.dev` exists; the GitHub homepage changes to that address at the same time.
- B6, `FUNDING.yml`: kept in andryore-web only.
- B5, `ROADMAP.md` and `PRODUCT.md`: optional, not adopted.

### Standard v2 (revised 2026-11-15)

The same six sessions agreed standard v2: 44 further rules, V01 to V44, each with a level (must, should, may), the project types it applies to and an ID that continues the letter series of the [standards](../standards/README.md) page that holds it. A new page, [product types](../standards/product-types.md), carries the CLI, plugin, site and bilingual rules under the letter I. The v2 text is the single source; v1 rules keep their IDs.

- aokit adopts standard v2. Rules that do not apply to aokit, by v2 number: V09 (accessibility and design files, no site or UI), V10 (privacy policy, no user data), V17 (`lint:parity`, the ESLint companion is not used), V27 (flaky-on-retry summary, no E2E suite), V34 (site build, no site), V40 (plugin contract, no plugin) and V41 and V42 (site and bilingual rules).
- Deferred, not rejected: the aokit site (G3 footer credit, V08 for the site, V41), `install.sh`, and a Claude Code plugin. Each applies when it ships.
- The standards README links the six adoption ADRs instead of copying their N-A lists, so a list is edited in one place only.
- aokit closes its own v2 gaps in separate tickets, citing the rule IDs in commits and ADR text.

## Consequences

- Scripts, issue forms, labels, the README top block and the release flow match the sibling repositories, so a contributor or an agent moves between them without relearning names.
- Release notes come from `CHANGELOG.md`, so a release needs a written section for its tag.
- A setting changed by hand in GitHub shows up as drift the next time the check runs.
- A rule that turns out wrong for one repository needs a change to the standard, or an entry in that repository's list of rules that do not apply, with a reason.

## Alternatives considered

- **A separate standards repository**: rejected. aokit's first-party Modules already encode the tooling rules, so the text and the Modules change in the same pull request.
- **One document per repository**: rejected. Six copies drift, which is the problem being fixed.
- **Recommendations without a vote**: rejected. The earlier pages stayed "pending" for that reason.
