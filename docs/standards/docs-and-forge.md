# Docs and forge

Conventions for documentation and for the agent and tracker workflow. They are encoded by the `adr-docs` Module in the [module catalog](../architecture/module-catalog.md). Index: [standards](README.md). Terms follow [CONTEXT.md](../../CONTEXT.md).

## Living ADRs

- Decisions live in `docs/adr/`, one file per decision, numbered, in Context / Decision / Consequences form.
- ADRs are **living**: a decision that changes is revised in place and gains a `Revised:` line with the date and a one-line reason. The number never changes and the original text is not deleted; a reversed decision says so in its Decision section.
- `docs/adr/README.md` is the index. An **index invariant test** checks that every ADR file is listed, every listed file exists, and every ADR has the required sections and a `Revised:` line when it has been revised. The test runs in CI and in the repository's own test runner.

## `CONTEXT.md`

`CONTEXT.md` at the repository root is the glossary: one definition per term with an `_Avoid_` list, relationships, and flagged ambiguities. Docs, code names and commit messages use its terms. A term change updates `CONTEXT.md` first.

## Agent files

- `AGENTS.md` at the repository root is the single source of agent guidance. Large monorepos may add one per workspace.
- `CLAUDE.md` contains only `@AGENTS.md`, so Claude Code reads the same file as every other agent.
- Skills live in `.claude/skills/<name>/SKILL.md`. Module-specific guidance belongs in a per-Module section of `AGENTS.md` or in a skill, not in prose scattered across docs.

## Linear

- The team key is `AO`.
- Every ticket sets `project` explicitly. **Sub-issues do not inherit the parent's project**, so an omitted `project` leaves the ticket orphaned.
- Tickets an agent may pick up carry the `ready-for-agent` label.
- Branches use the `ao` prefix, for example `ao-2679-short-title`.
- The forge configuration points its tracker at Linear.

## Trunk branch

The trunk branch is a per-repo setting, not a standard: some repositories use `main`, others use `develop` with promotion to `main`. aokit asks for it at `create`, records it in the generated forge configuration, and never assumes one.
