# 0004. Own registry protocol with a shadcn adapter and integrity hashes

Status: Accepted (2026-11-03)
Spec: S12, S7 (AO-2673)
Architecture: [Registry](../architecture/registry.md), [Lockfile: old versions stay fetchable](../architecture/lockfile.md#old-module-versions-stay-fetchable)

## Context

A Registry must serve Module manifests, a Catalog per release, and every old Module version, because `update` and `remove` re-render the recorded state. The shadcn registry is widely used for UI items but has no versions, no lockfile and no integrity hash, and its items carry no `provides`/`requires`.

## Decision

aokit speaks its own manifest index: JSON, versioned, inspired by shadcn, with immutable `modules/<name>/<version>` entries, `sha256:<hex>` integrity per manifest and file, and a Catalog per release. A shadcn adapter reads shadcn registry items (declarative only) and presents them as synthetic Module manifests, adding a synthetic version, integrity, per-file hashes and ownership. Remote sources given as mutable refs are pinned to a commit SHA. Registries other than `official` and `local` are untrusted until the user allows them; arbitrary transforms and remote scripts are blocked without consent, and `--yes` never grants trust.

## Consequences

- Consuming shadcn components needs no rewrite, while Plan, Lockfile and integrity stay aokit's.
- The Registry must keep every published version fetchable (yank is a flag, not a deletion).
- Two formats to maintain: the protocol and the adapter mapping.
- Non-interactive and agent runs fail on untrusted Registries with the exact `--trust` form.

## Alternatives considered

- **shadcn registry as the only protocol**: rejected because it lacks versions, integrity, Capabilities and a Catalog.
- **Mutable `latest` with no integrity** (how shadcn items behave today): rejected because it cannot support a reproducible `update`.
