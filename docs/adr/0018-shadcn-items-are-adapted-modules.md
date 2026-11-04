# 0018. shadcn items become declarative Adapted Modules with a synthetic version and a mandatory cache

Status: Accepted (2026-11-04)
Spec: S1 to S15 (Spec: Phase 5b, shadcn adapter)
Architecture: [Registry: shadcn adapter](../architecture/registry.md#shadcn-adapter)

## Context

shadcn items are the largest source of copy-in UI code, but a shadcn Registry has no versions, no integrity and no history: a URL serves the current item and nothing else. aokit's Plan, Lockfile, `update`, `doctor` and `remove` all assume a Module with a semver version and a verifiable integrity. Private shadcn Registries also need authenticated requests, which must not leak a secret to the Lockfile, the logs or another host.

## Decision

A shadcn item is adapted into an Adapted Module: a declarative synthetic manifest (`files`, `deps`, `env` and Ops, never a transform, script or migration) that follows the same Plan, Lockfile, trust, cache and lifecycle paths as a native Module.

- **Name**: `@ns/item`, accepted only for Adapted Modules. A shadcn Registry without a Namespace uses its Lockfile Registry key as the scope.
- **Version**: the semver `0.0.0-shadcn.<12hex>`, where the hex is a prefix of the sha256 of the item JSON (or of the commit SHA for git sources). The full integrity is stored separately, so Lockfile v2 stays valid and there is no v3.
- **Namespaces** are configured under `registries` in the user config. They are always shadcn kind, with a `url` containing `{name}` and optional `headers`. `@shadcn` (`https://ui.shadcn.com/r/{name}.json`) is built in, and like any remote Registry it is untrusted until the user trusts it.
- **Auth**: `${VAR}` in `url` and `headers` expands from the environment and `.env` at request time. Only the placeholder is persisted or logged; an unset variable fails with `REGISTRY_ENV_UNSET` naming it. Headers go only to the Namespace's own origin and are dropped on a cross-origin redirect.
- **Cache**: the integrity cache is mandatory for shadcn items, because the origin keeps no history. A command that finds the recorded integrity neither cached nor served fails with `REGISTRY_ITEM_CHANGED` and suggests `update`; an upstream change appears in `update --plan` as an update.
- **Item types**: all twelve except `base` and `font`, which are deferred and fail with `REGISTRY_ITEM_UNSUPPORTED` naming the item.
- **CSS**: `cssVars` use a new public Op, `addCssVariables`, and items with `css`, `cssVars`, `theme` or `style` require the `styling` Capability.
- **Ownership**: `page` and `file` items are `seed`; every other type is `managed`.

## Consequences

- shadcn items work with `update`, `doctor` and `remove` without a second code path.
- A secret never reaches disk, logs or `--json`; a cloned Project needs the variable only when it fetches.
- An upstream change to an item cannot be re-applied silently.
- The cache becomes a correctness dependency for shadcn, not only an optimisation.
- Two shadcn Registries serving a same-named item without a Namespace are told apart by their Registry key.

## Alternatives considered

- **Resolve the version from upstream metadata**: rejected. shadcn items carry none, so the version would be invented anyway.
- **Lockfile v3 with a non-semver version**: rejected. It forces a migration for a field that a pre-release semver already carries.
- **Optional cache with a refetch fallback**: rejected. A refetch of a changed item would silently diverge from the recorded integrity.
- **Namespaces of aokit kind**: deferred. Nothing needs them yet, and one kind keeps the config schema small.
- **`base` and `font` now**: deferred. Both need Module-specific config handling that no curated Module consumes yet.
