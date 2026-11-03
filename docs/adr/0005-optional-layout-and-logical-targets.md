# 0005. Layout is optional and logical targets decouple modules from paths

Status: Accepted (2026-11-03)
Spec: S4 (AO-2673)
Architecture: [Layouts](../architecture/layouts.md), [Capabilities: deriving compatibility](../architecture/capabilities.md#deriving-compatibility)

## Context

Andry builds both simple sites and multi-package products. S4 states it directly: "el monorepo debe ser opcional". A scaffolder that forces a monorepo burdens a landing page, while one that hardcodes paths cannot support both shapes.

## Decision

The user chooses the Layout at `create`: `single` or `monorepo`. No Module may force it; `requires` accepts only Capabilities and Extension points, so nothing can demand `monorepo`. Modules write to logical Targets (`root`, `web`, `server`, `db`, `shared-ui`, `config`) and the Layout resolves each to a path and decides cross-Target wiring (workspace dependency versus relative import). The Layout is recorded in the Lockfile. `aokit layout migrate` is optional and explicit. Separate repositories are separate Projects; cross-repo integration is out of scope.

## Consequences

- Every Module must produce a valid Project on both Layouts, or be a reported no-op (`turborepo` on `single`).
- The CI matrix crosses valid selections with both Layouts.
- A Target a Layout cannot resolve is a Resolver error naming the Modules that provide it.
- Adding a Layout later means adding a resolution table, not changing Modules.
- The app Targets `web` and `server` are package roots (`./` in `single`, `apps/<name>` in `monorepo`); Modules write `src/…` themselves, and `{{target:<name>}}` lets a Module name a Target without knowing the Layout (revised 2026-11-03, phase 3 wave 2).

## Alternatives considered

- **Always monorepo**: rejected as disproportionate for simple Projects.
- **Modules declare paths**: rejected because it duplicates Layout knowledge in every Module.
- **A `requires` predicate for a Layout**: rejected because it lets a Module force the Layout.
