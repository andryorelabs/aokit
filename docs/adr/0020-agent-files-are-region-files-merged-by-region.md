# 0020. Agent files are Region files, merged by Region and owned in part by aokit

Status: Accepted (2026-11-04)
Spec: S1 to S13 (phase 6b spec)
Architecture: [Interfaces: agent files](../architecture/interfaces.md#agent-files-in-generated-projects), [Engine: marker regions](../architecture/engine.md#marker-regions), [Lockfile: Region files](../architecture/lockfile.md#region-files)

## Context

`AGENTS.md` and `CLAUDE.md` are shared by every Module and by the user. Each Module must own only its section, aokit must add a header that belongs to no Module, and the user's own notes must survive `add`, `remove` and `update`. The Lockfile gives a file exactly one [Ownership mode](0011-file-ownership-modes-and-per-file-hashes.md). A `seed` file is never updated after its first write, so `add` and `remove` could not change it. A `managed` file is merged line by line, so a note the user appends at the end of the file collides with a Region that `add` appends at the same spot.

## Decision

- **Region files.** The root `AGENTS.md` and `CLAUDE.md` are Region files. They stay `managed`: there is no new Ownership mode and no Lockfile schema change.
- **Regions.** A Region is the span between `<!-- aokit:begin <id> -->` and `<!-- aokit:end <id> -->`, with `<id>` set to `<module>:<region>`. A Module owns only its own Regions, written by the `appendRegion` Op with inline content.
- **Region Merger.** For a Region file the Merger replaces each Region the user did not edit with its next content, deletes Regions that the next Render no longer has, and never changes text outside markers. A Region the user edited is 3-way merged on its own, so Conflict markers stay inside that Region. A new Region goes right after the closest earlier Region (in the next Render's order) that the file already has, so Region order always equals a fresh Render's and notes the user kept at the end stay at the end.
- **Adoption.** A user-authored `AGENTS.md` or `CLAUDE.md` with no aokit markers is adopted: its text is kept after the inserted Regions, with no Conflict.
- **Hash over Regions.** The Lockfile hash of a Region file covers only its normalized aokit Regions. Text outside markers is not drift; an edit inside a Region is `modified`.
- **Core owner.** aokit itself contributes the `aokit:header` Region (Layout, Target table, commands) and `CLAUDE.md`'s `aokit:claude` Region (`@AGENTS.md`). The name `aokit` is a reserved pseudo-owner in the Lockfile and in Provenance. No Module may be named `aokit` or write these two paths through `files[]`.
- **Skills.** A Skill is a plain `files[]` entry at `.claude/skills/<name>/SKILL.md` owned by its Module. `registry:build` checks its frontmatter: `name` equals the directory and `description` is not empty.

## Consequences

- `add`, `remove` and `update` keep one Region per Module without touching user notes, and `doctor` stays `pristine` when only notes change.
- The Merger gains a path-specific branch, as it already has for JSON and binary files.
- Every writer and reader of a file hash must use the Region-aware hash, or a Region file would show as `modified` forever.
- Modules cannot own `AGENTS.md` or `CLAUDE.md` outright; the planned `adr-docs` Module contributes Regions and Skills only.
- Content changes ship as new Module versions, so phase 6b needs a new Release.

## Alternatives considered

- **`seed` for the user part, `managed` for Regions in one file**: rejected. One file has one mode, and a `seed` file is never updated.
- **A new `regions` Ownership mode**: rejected. It changes the Lockfile schema and every mode switch for a rule that depends on the path alone.
- **`managed` with plain 3-way merge**: rejected. Notes appended at the end conflict with an appended Region on the first `add`.
- **One file per Module** (`AGENTS.<module>.md`): rejected. Agents read `AGENTS.md` only, and `CLAUDE.md` can import a single file.
- **A Module that always ships the header**: rejected. It would be a Module every Project must select, which the Resolver models badly.
