# 0016. Update moves a Project between Releases

Status: Accepted (2026-11-03)
Spec: S6, S7 (Spec: Phase 4b, updates and migrations)
Architecture: [Lifecycle: update](../architecture/lifecycle.md#update), [Registry: layout](../architecture/registry.md#layout-of-a-registry)

## Context

A Project records exact Module versions in its Lockfile. Moving it forward needs a target. The Registry can offer the newest version of each Module independently, or the versions that a [Release](../../CONTEXT.md) groups together with its Catalog. Modules agree through Capabilities and Extension point ranges, and the Catalog pins the dependencies tested with them. A mix of newest versions has never been built together.

## Decision

`update` targets a Release. The target is the latest Release in the Registry index, or the one named by `--to <release>`, and that Release's index entry fixes the version of every Module. The Project's Lockfile records the Release it came from, so a target older than that is a usage error (exit `3`). A Module of the Lockfile that the target Release does not contain fails with `MODULE_VERSION_UNAVAILABLE` and the fix `aokit remove <module>`. There is no per-Module update. Migrations and the Renames manifest of every version crossed run in order, Modules in canonical Resolver order and, within a Module, by target version.

## Consequences

- Every state `update` produces is one the Registry maintainers built and tested together, and the Upgrade job can prove it for each pair of consecutive Releases.
- A user cannot take one Module's fix alone; they take the Release, or wait for the next one.
- A Release must be published for a Module bump to reach Projects, which keeps Releases cheap and frequent.
- `check` and `diff --to` compare against the same target the `update` would use, so the preview is exact.

## Alternatives considered

- **Newest version of each Module independently**: rejected because the combination is untested and Extension point ranges would have to be re-resolved on every update.
- **`update <module>` as well**: deferred. It would reuse the same machinery, but it breaks the "tested together" guarantee and is not needed to carry a Project forward.
