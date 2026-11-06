# AGENTS.md: packages/aokit

Rules for the `aokit` package, on top of the [root guide](../../AGENTS.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Layout

- `src/`: one directory per subsystem (`cli`, `engine`, `registry`, `lifecycle`, `lockfile`, and so on). `src/cli/commands/` holds one file per command.
- `test/`: mirrors `src/`; a module is tested by importing it directly.
- Published files are `dist/` and `registry/` only.

## Rules

- Public entry is `aokit/cli`; the `exports` map is the whole public surface. Do not deep-import from other packages.
- Exit codes live in `src/cli/exit-codes.ts`. A new code needs a docs row in the same change.
- Lifecycle outcomes are error codes with data. See [ADR-0015](../../docs/adr/0015-lifecycle-outcomes-are-error-codes-with-data.md).
- Edits go through the locate-and-splice engine and atomic writes. See [ADR-0010](../../docs/adr/0010-locate-and-splice-edit-engine.md) and [ADR-0012](../../docs/adr/0012-deterministic-generation-and-atomic-writes.md).
- Keep output deterministic: no clocks, random values or machine paths in generated files.
- Add tests instead of lowering the coverage threshold; raise it when coverage rises.
