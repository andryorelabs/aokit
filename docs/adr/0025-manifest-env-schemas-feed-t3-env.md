# 0025. Manifest env schemas feed env.server and env.client

Status: Accepted (2026-11-08)
Spec: S6 (AO-2914, Module expansion)
Architecture: [Module contract](../architecture/module-contract.md), [Capabilities](../architecture/capabilities.md)

## Context

Modules declare environment variables in `env[]` (for example `DATABASE_URL` for `prisma`). The `t3-env` Module validates variables in `src/env.ts`. Without a link between them, either every Module hardcodes an edit to `src/env.ts`, which breaks when `t3-env` is absent, or the validated list drifts from the real variables.

## Decision

- An `env[]` entry may set `visibility` to `server` or `client`, and `schema`, the validator expression for the value.
- `t3-env` declares the Extension points `env.server` and `env.client` in `src/env.ts`. When an entry has a `schema` and `visibility`, the engine registers `KEY: <schema>` in the matching Extension point.
- Without `t3-env` the `schema` is skipped. No `src/env.ts` is written and the entry still lands in the example env file.
- No secret is generated; the example value stays a placeholder ([ADR 0012](0012-deterministic-generation-and-atomic-writes.md)).

## Consequences

- A data Module states its variable once; validation appears whenever `t3-env` is selected.
- Modules never depend on `t3-env`, so the selection stays free.
- A `schema` is code in the manifest, so it is written against the validator `t3-env` ships and tested with `t3-env` selected.

## Alternatives considered

- **Each Module edits `src/env.ts` directly**: rejected. It requires `t3-env`, which a Module must not force.
- **`t3-env` reads every `env[]` entry without a `schema`**: rejected. It cannot choose a validator, so it would guess.
- **A separate env manifest section**: rejected. It duplicates `env[]` and splits one declaration in two.
