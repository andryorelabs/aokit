# 0003. `remove` re-renders without the module and 3-way merges

Status: Accepted (2026-11-03)
Spec: S6, S7 (AO-2673)
Architecture: [Lifecycle: remove](../architecture/lifecycle.md#remove-module), [Lifecycle: merge procedure](../architecture/lifecycle.md#the-merge-procedure), [Lockfile: merge policy](../architecture/lockfile.md#merge-policy)

## Context

Generated Projects must stay maintainable, which includes taking a Module out after the user edited files it touched. Ops edit shared files (`package.json`, provider lists, env schema), so deleting the Module's own files is not enough.

## Decision

`remove <module>` builds the **base** (the Lockfile render of all Modules at recorded versions and answers), the **new** state (the same selection without the Module) and the **user** state (the working tree), then runs the same merge procedure as `update`, `add` and `recopy`. Files owned only by the removed Module are deleted if `pristine` and become a delete-vs-modify conflict (kept, with a warning) if `modified`. Files with several owners are re-rendered without that Module's contribution and 3-way merged. Dependents are checked first; dependencies are removed only if unused, and `source: "user"` dependencies never. A clean working tree is required.

## Consequences

- One merge machine serves every lifecycle command, so there is one place to test and fix conflict behavior.
- `remove` depends on old Module versions staying fetchable and immutable, see [ADR 0004](0004-own-registry-protocol-with-shadcn-adapter.md) and [ADR 0011](0011-file-ownership-modes-and-per-file-hashes.md).
- Conflicts are possible and surface as markers (exit code 6); nothing is deleted on a doubt.
- Ejected files are left as they are and may still reference the removed Module; the Plan says so.

## Alternatives considered

- **Inverse Ops**: rejected, see [ADR 0002](0002-extension-points-and-declarative-ops.md); the [lifecycle research](../research/lifecycle-and-versions.md) concludes inverse operations are unreliable.
- **Delete only the Module's own files**: rejected because contributions in shared files would be left dangling.
- **Regenerate and overwrite**: rejected because it destroys user edits.
