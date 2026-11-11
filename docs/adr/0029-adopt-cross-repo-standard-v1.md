# 0029. aokit adopts the cross-repo standard v1

Status: Accepted (2026-11-11)
Revised: 2026-11-11 — the branch model is a must: `develop` is promoted to `main` by merge commit
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

## Consequences

- Scripts, issue forms, labels, the README top block and the release flow match the sibling repositories, so a contributor or an agent moves between them without relearning names.
- Release notes come from `CHANGELOG.md`, so a release needs a written section for its tag.
- A setting changed by hand in GitHub shows up as drift the next time the check runs.
- A rule that turns out wrong for one repository needs a change to the standard, or an entry in that repository's list of rules that do not apply, with a reason.

## Alternatives considered

- **A separate standards repository**: rejected. aokit's first-party Modules already encode the tooling rules, so the text and the Modules change in the same pull request.
- **One document per repository**: rejected. Six copies drift, which is the problem being fixed.
- **Recommendations without a vote**: rejected. The earlier pages stayed "pending" for that reason.
