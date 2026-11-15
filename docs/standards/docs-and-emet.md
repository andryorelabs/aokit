# Docs and emet

Conventions for documentation and for the agent and tracker workflow. They are encoded by the `adr-docs` Module in the [module catalog](../architecture/module-catalog.md). Index: [standards](README.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md). Agent tooling files are in [agent tooling](agent-tooling.md).

Each rule is marked **must** or **should**, gives one sentence, then the reason. Rules from standard v2 carry their V number and project types, defined in the [legend](README.md#levels-and-project-types).

## Docs rules

- **D1** (must) `docs/README.md` indexes every doc, and a test fails when a doc is missing from it. Reason: an unindexed doc cannot be found and goes stale unseen.
- **D2** (must) ADR files are named `NNNN-kebab-title.md` with `Status:` and `Date:` at the top, in one form per repo, and a living ADR carries a `Revised:` line, is listed in the ADR index and is covered by an invariant test; the template is D6. Reason: one form lets the test and the reader find the state of a decision at once.
- **D3** (must) `docs/architecture.md` or `docs/architecture/` holds an overview, and `docs/development.md` (linking to these standards), troubleshooting and security docs exist, plus a configuration doc when the code reads environment variables. Reason: a new contributor and a new agent find the same starting points in every repo.
- **D4** (must) `AGENTS.md` is the single agent entry, `CLAUDE.md` contains only `@AGENTS.md`, and `AGENTS.md` has the sections Layout, Running scripts, Rules, ADRs, Branch and commit conventions, Code comments and Quirks, with repo-specific sections between the last two. Reason: every agent reads the same file in the same order.
- **D5** (must) `docs/agents/{domain,emet,issue-tracker,triage-labels}.md` describe the repo they live in, and a test fails on a stale name outside an allowlist. Reason: an agent follows instructions for a tool that no longer exists when old names linger.
- **D6** (V01, must, all) ADRs have a template at `docs/adr/0000-template.md`, and the ADR invariant test checks `Revised:` lines. Reason: every ADR starts from the same form, and a revision is visible to the test.
- **D7** (V02, must rel, should all) `docs/how-to/` has an index, and `docs/how-to/cut-a-release.md` is the release runbook. Reason: a recurring task is written down once, where it can be found.
- **D8** (V03, should, all) The project skills are `add-adr` and `cut-release` only, in `.claude/skills`, with one shared source in aokit, which ships them as Modules; `git-commit` is user-global and is not a project skill. Reason: every repo gets the same skill text from one place.
- **D9** (V04, should, all) `docs/agents/codebase.md` is the codebase map for agents. Reason: an agent finds the layout without walking the tree.
- **D10** (V05, must, where code reads env) Every environment variable the code reads is documented in `docs/configuration.md`, a test enforces it, and a CLI or plugin reads the environment through one module. Reason: an undocumented variable is a hidden interface.
- **D11** (V06, must, all) `CHANGELOG.md` has the Keep a Changelog and SemVer preamble, Added, Changed and Fixed groups, and a compare-link reference for every version, enforced by a test. Reason: a changelog that is not checked drifts from the tags.
- **D12** (V07, must, all) One `standard-invariants` test per repo covers legacy slugs and names, the README slogan equal to the manifest description and to the brand copy, every doc indexed, and `skills-lock.json` against `.claude/skills` in both directions. Reason: the cross-file invariants are checked in one place.
- **D13** (V11, should, CLI and plugin) `docs/reference/dependencies.md` lists the machine prerequisites and the check for each. Reason: a missing tool is found by a command, not by a failure.

## Living ADRs

- Decisions live in `docs/adr/`, one file per decision, numbered, in Context / Decision / Consequences form.
- ADRs are **living**: a decision that changes is revised in place and gains a `Revised:` line with the date and a one-line reason. The number never changes and the original text is not deleted; a reversed decision says so in its Decision section.
- `docs/adr/README.md` is the index. **aokit only:** the test described here is aokit's own, and other repos write their own. An **index invariant test** checks that every ADR file is listed, every listed file exists, and every ADR has the required sections and a `Revised:` line when it has been revised. The test is `tools/docs/docs-invariant.test.ts`; it also checks that every relative Markdown link in `docs/`, `README.md` and `GLOSSARY.md` resolves to a file and, with an anchor, to a heading (GitHub slugs), and that every ADR has `Status:`, `Spec:` and `Architecture:` lines. It runs in CI and in the repository's own test runner.

## `GLOSSARY.md`

`GLOSSARY.md` at the repository root is the glossary: one definition per term with an `_Avoid_` list, relationships, and flagged ambiguities. Docs, code names and commit messages use its terms. A term change updates `GLOSSARY.md` first.

## Agent files

- `AGENTS.md` at the repository root is the single source of agent guidance. Large monorepos may add one per workspace.
- `CLAUDE.md` contains only `@AGENTS.md`, so Claude Code reads the same file as every other agent.
- Skills live in `.claude/skills/<name>/SKILL.md`. Module-specific guidance belongs in a per-Module section of `AGENTS.md` or in a skill, not in prose scattered across docs.

## Linear

The emet configuration names the tracker: Linear (team AO) or GitHub issues. The bullets below apply to Linear-tracked repos.

- The team key is `AO`.
- Every ticket sets `project` explicitly. **Sub-issues do not inherit the parent's project**, so an omitted `project` leaves the ticket orphaned.
- Tickets an agent may pick up carry the `ready-for-agent` label.
- Branches use the `ao` prefix, for example `ao-2679-short-title`.
- The emet configuration points its tracker at Linear.

## Trunk branch

Andry's repositories use `develop` as the trunk, promoted to `main` as [rule A1](repo-settings.md#merging) requires. A generated Project chooses its own trunk: aokit asks for it at `create`, records it in the generated emet configuration, and never assumes one.
