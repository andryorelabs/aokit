# 0002. Modules integrate through versioned extension points and declarative ops (no inverse ops)

Status: Accepted (2026-11-03)
Spec: S2, S3, S5 (AO-2673)
Architecture: [Capabilities](../architecture/capabilities.md#extension-points), [Engine](../architecture/engine.md#ops-catalog), [Module contract](../architecture/module-contract.md)

## Context

Modules must contribute to files they do not own (a provider into the web app, a middleware into the server) without knowing paths and without editing each other. Contributions also have to survive upgrades of the base Module, and `remove` has to take them out again. Templates with conditionals solve the first problem by coupling every Module to shared files.

## Decision

Base Modules declare named, semver-versioned Extension points (`web.providers`, `server.middleware`, `env.schema`) with a `target`, `kind` and `anchor`. Other Modules require them as `ext:<name>@<range>` and contribute through declarative Ops from a closed catalog (`addImport`, `addToArray`, `registerAt`, `mergeJson`, `mergeYaml`, `addEnv`, `addCssAtRule`, `appendRegion`). Renaming, removing or changing the `kind` of an Extension point is a major change that ships with a Module migration. Ops are one-way: no Op has an inverse. Arbitrary transform code exists but is honored only from a trusted Registry.

## Consequences

- Contributors depend on Extension points, never on file paths; a base Module may move its files freely inside a major version.
- The Op catalog is a stable, reviewable surface that the Engine can plan, diff and test in the VFS.
- Anything outside the catalog needs a new Op or a trusted transform, which raises the bar for exotic integrations.
- Because Ops are never reversed, `remove` needs a different mechanism, see [ADR 0003](0003-remove-by-rerender-and-three-way-merge.md).

## Alternatives considered

- **Template conditionals in shared files** (`{{#if}}`, as in Better-T-Stack): rejected because option logic spreads across files and every Module edits shared templates.
- **Contributing by file path or glob**: rejected because it couples Modules to another Module's layout and breaks silently on moves.
- **Inverse Ops** (each Op ships an undo): rejected because undo is unreliable once the user edited the file or other Ops stacked on the same anchor, and it doubles the surface to test.
- **Arbitrary code only** (every Module is a script): rejected because it cannot be planned, diffed or safely taken from untrusted Registries.
