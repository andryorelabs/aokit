# 0026. Registry Releases are dated, CLI versions are semver

Status: Accepted (2026-11-09)
Spec: S1, S2 (Release 2026.12.1, release pipeline and new-project verification)
Architecture: [Distribution](../architecture/distribution.md#release-tooling), [Versions](../architecture/versions.md)

## Context

aokit has two kinds of version. A Registry Release is a snapshot of the Modules and the one Catalog tested together (`2026.12.0`). The CLI version is the program that reads it, shipped as the npm packages `aokit` and `create-aokit` and as standalone binaries. The first Releases used dates; the packages started at `0.1.0`. The question came up when preparing the first npm publish: should Releases move to semver too?

## Decision

- A Registry Release keeps the name `YYYY.MM.PATCH` (the next one is `2026.12.1`). It is a dated snapshot of dependency versions and Modules, not an API with compatible and breaking changes. Modules inside a Release already use semver.
- `aokit` and `create-aokit` share one semver version, released together with `bumpp` and `changelogithub`. A version with a pre-release part (`0.1.0-next.0`) is published under the npm dist-tag `next`; any other under `latest`.
- A Registry index can still require a minimum CLI version, which ties the two schemes together.

## Consequences

- No Release, Lockfile `release` field, Registry index or `update` logic needs migrating.
- Contributors must not read `2026.12.1` as "a patch of 2026.12.0 that is safe to ignore": any Release can change dependency ranges, so `update` always shows a plan.
- The two version schemes appear side by side in docs; the glossary keeps them apart ("Release" always means a Registry Release).

## Alternatives considered

- **Semver for Releases**: rejected. It would migrate published immutable Releases, the index and `update` for no gain, and a snapshot has no meaningful major or minor.
- **Calendar versions for the packages**: rejected. npm tooling, `bunx` ranges and pre-release tags expect semver.
