# 0021. Layout migration pairs files by Provenance and moves seed files as they are

Status: Accepted (2026-11-06)
Spec: S1 to S8 (phase 8 spec)
Architecture: [Layouts: layout migrate](../architecture/layouts.md#layout-migrate), [Lifecycle: the merge procedure](../architecture/lifecycle.md#the-merge-procedure)

## Context

[ADR 0005](0005-optional-layout-and-logical-targets.md) made `layout migrate` optional and explicit, and [ADR 0003](0003-remove-by-rerender-and-three-way-merge.md) made lifecycle commands a re-render plus a 3-way merge. A Layout migration moves files, and the user's edits must follow them. The Lockfile records no Target per file, and a [Renames manifest](../architecture/lifecycle.md#renames-manifest) belongs to a Module version, not to a Layout. The merge's rename path accepts only `managed` files, so a seed the user edited would stay at its old path while a fresh seed appeared at the new one. `update --abort` reads a single undo marker, so a conflicted migration could be undone by the wrong command.

## Decision

- **Pairing by Provenance.** The base is the Render of the Lockfile at its Layout and the next is the Render of the same Lockfile at the new Layout. A file with the same Module and the same file entry in both Plans is a rename from its base path to its next path, passed to the merge as `renames`.
- **Not renames.** A path equal in both Renders, and several base paths that land on one next path, are not renames. The normal merge policy decides them, so a collapse never picks a side silently.
- **Seeds move unmerged.** In `layout migrate` only, a seed at a renamed path moves to the new path with its current content. If the destination exists on disk it is a Conflict. `update` keeps its seed behaviour.
- **Unknown files stay.** Files not in the Lockfile are never moved; each is a warning.
- **Same Layout is a no-op.** It writes nothing and returns `data.changed: false`.
- **One undo marker with a kind.** The marker records `update` or `layout-migrate`; a marker without a kind is `update`. `--abort` of the other command fails with `INVALID_INPUT` and touches nothing.
- **No two-phase flow.** `layout migrate` has `--dry-run` and `--diff` but no `--plan` / `--apply`.

## Consequences

- Migration reuses the lifecycle orchestrator, the merge procedure and transactional apply, with no second merge path.
- A migrated Project equals a fresh `create` at the new Layout when the user made no edits, which is directly testable.
- Pairing depends on Provenance entries staying accurate for every file a Module writes.
- Files a user created under old Target directories need a manual move.
- The merge gains a `seedMoves` input used only by this command.

## Alternatives considered

- **Rewrite paths from the Layout tables**: rejected. It needs each file's Target, which the Lockfile does not record, and breaks for files a Module places by explicit path.
- **Match files by content hash**: rejected. Edited files no longer match, which is exactly when the pairing matters.
- **Merge seed files like managed files**: rejected. A seed is the user's code after its first write, and merging it contradicts its Ownership mode.
- **Move unknown files by Target prefix**: rejected. It guesses where user code belongs.
- **A separate undo marker file**: rejected. Two markers can coexist and `doctor` would need to rank them; one marker with a kind is one source of truth.
