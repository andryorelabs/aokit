# 0006. Bun-only

Status: Accepted (2026-11-03)
Spec: S11, S8 (AO-2673)
Architecture: [Distribution: Bun only](../architecture/distribution.md#bun-only), [Dependency versions: Bun catalogs](../architecture/versions.md#bun-catalogs-for-the-monorepo)

## Context

Andry's stack is Bun. Supporting several package managers multiplies the install, catalog, lockfile and CI surface, and the generated Projects would stop being uniform.

## Decision

aokit and the Projects it generates are Bun-only: `bunx create-aokit`, `bunx aokit add auth`, `bun install` after apply, `bun.lock`, Bun catalogs for the `monorepo` Layout, and a standalone binary from `bun build --compile` for machines without Bun. There is no package-manager abstraction. Bun-specific APIs sit behind a small adapter as a hedge for Node 22 or later; that is not a supported install path.

## Consequences

- One install path, one lockfile format and one catalog mechanism to test.
- Users on npm or pnpm are not served; this is deliberate.
- Renovate lacks Bun catalog support, so catalog updates use the workaround in [versions](../architecture/versions.md#renovate-and-the-registry-catalog).
- The binary needs its own constraints (dotenv and bunfig autoload disabled, static or asset Modules).

## Alternatives considered

- **Package-manager abstraction** (npm, pnpm, Bun): rejected because it multiplies surface for no benefit to the target user.
- **pnpm catalogs for monorepos**: rejected because no pnpm path exists.
