# 0024. Pending Modules, Catalog fragments and explicit Release cuts

Status: Accepted (2026-11-08)
Spec: S2, S4, S18 (AO-2914, Module expansion)
Architecture: [Versions: the Catalog](../architecture/versions.md), [Versions: CI](../architecture/versions.md#ci)

## Context

The Module expansion adds about 40 Modules. A Release is immutable and its Catalog is tested as a whole ([ADR 0007](0007-ranges-and-lockfile-with-toolchain-pin-groups.md)), so shipping each Module as it lands would cut dozens of Releases, each with an Upgrade job. Yet every Module needs a VFS test and a matrix entry while it is still being written, and those need the dependency versions the Module will ship.

## Decision

- **Pending Module.** A Module with a `registry-src/<module>/catalog.json` Catalog fragment and no published version is a Pending Module. `registry:build` skips it, so `registry/` stays unchanged while Modules land.
- **Catalog fragment.** The fragment lists only the dependencies the latest Release Catalog does not have. It never redefines a released dependency.
- **Draft Catalog.** `composeDraftCatalog()` merges the latest Release Catalog with every fragment. It errors when two fragments give the same dependency different ranges or when a fragment redefines a released dependency. VFS tests and the matrix resolve against the draft Catalog.
- **One Release cut.** A single Release, `2026.12.0`, is cut at the end of the expansion: its Catalog is `2026.11.2` plus all fragments, the fragments are deleted, `registry/` is rebuilt, a release test is added and the Upgrade job from `2026.11.2` runs green.
- **Ordinary work stays ordinary.** Until the cut, no ticket edits `registry/` or another Module's source.

## Consequences

- A Module lands with its tests in one pull request and no Release.
- Two Modules that need the same new dependency must agree on the range; the conflict surfaces in the first test run, not at the cut.
- The cut is one large, reviewable change instead of many small Releases, and the Upgrade job proves the whole jump once.
- Until the cut, `aokit create` offers only the published Modules.

## Alternatives considered

- **One Release per wave**: rejected. It multiplies Upgrade jobs and immutable Catalogs for states no user needs.
- **A mutable `catalog/next.json`**: rejected. Parallel work would edit one file and conflict, and a mutable Catalog undermines the rule that Catalogs are immutable once released.
- **Per-Module snapshot files** of the whole Catalog: rejected. Each copy repeats the released dependencies and drifts from the others.
