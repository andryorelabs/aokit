# 0007. Ranges + lockfile by default with toolchain pin groups

Status: Accepted (2026-11-03)
Spec: S8 (AO-2673)
Architecture: [Dependency versions](../architecture/versions.md), [Module contract: deps](../architecture/module-contract.md#deps)

## Context

Generated Projects need reproducible installs and current dependencies. The active reference repositories use ranges with Renovate `bump` and `minimumReleaseAge`, and pin only toolchain packages. Some packages must move together: the Oxc formatter changes output between versions and is part of the deterministic format phase, and TypeScript 6 and 7 must coexist.

## Decision

Dependencies are written as semver ranges from the Catalog and reproduced by `bun.lock`; Renovate (`rangeStrategy: "bump"`, `minimumReleaseAge`) keeps them current. Exactly pinned are the Toolchain pin groups (`oxc`, `typescript7`), marked with `pinGroup` so every Module naming a group moves together; Renovate opens one PR per group, never automerged. `aokit deps pin [pkg]` is the opt-in for exact versions. Bun catalogs are emitted as bare `catalog:`. CI runs a capability-derived matrix and an upgrade job (release N-1 to N with zero conflicts).

## Consequences

- Renovate PRs stay small and Projects match the reference repositories.
- The recorded `deps.<name>` state `{version, pinned, source}` lets `update` respect user choices.
- Registry catalogs live as `catalog/<release>.json` and need a jsonata `customManager` until Renovate supports Bun catalogs.
- Range drift is possible between lockfile refreshes; the lockfile and `minimumReleaseAge` are the guard.

## Alternatives considered

- **Pin everything**: rejected because each Renovate PR becomes a noisy exact-version change and no active reference repo does it.
- **Ranges for everything, including the toolchain**: rejected because a floating formatter breaks byte-identical generation.
- **`catalog:default` references**: rejected because it has behaved inconsistently across Bun versions and tools.
