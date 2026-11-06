# AGENTS.md: packages/module

Rules for `@aokit/module`, on top of the [root guide](../../AGENTS.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Layout

- `src/`: the Module manifest contract (`define`, `manifest`, `ops`, `compile`, `catalog`, `migration`, `json-schema`). `src/index.ts` is the public entry.
- `test/`: contract tests.

## Rules

- This package is the contract Module authors depend on. A change to an exported type or schema is a breaking change unless it only adds optional fields; say so in the PR.
- The manifest is declarative: Modules use declarative ops, not code that runs at generation time. See [ADR-0002](../../docs/adr/0002-extension-points-and-declarative-ops.md).
- Extension point anchors are identifier names. See [ADR-0014](../../docs/adr/0014-extension-point-anchors-are-identifier-names.md).
- One Zod schema is the source for validation and JSON Schema. See [ADR-0009](../../docs/adr/0009-one-zod-schema-for-all-interfaces.md).
- The package imports nothing from `packages/aokit`.
- Add tests instead of lowering the coverage threshold; raise it when coverage rises.
