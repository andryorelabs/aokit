# 0008. Oxc as default tooling with a full-rule ESLint companion

Status: Accepted (2026-11-03)
Spec: S14 (AO-2673)
Architecture: [Module catalog: quality and tooling](../architecture/module-catalog.md#quality-and-tooling); standard: [Tooling](../standards/tooling.md)

## Context

The four active reference repositories converged on Oxc, but Oxlint cannot yet run every rule: `**/*.astro` files and some type-aware rules still need ESLint. Migration helpers have produced configs that dropped rules.

## Decision

The default `oxc` Module provides `lint` and `format` with Oxfmt, Oxlint `--type-aware`, and the original `unicorn` and `jsdoc` rules through `jsPlugins` aliases. A rule is never relaxed to pass. ESLint stays as an `eslint` companion with the full project rule set on `**/*.astro` and for type-aware rules Oxlint cannot run. ESLint is cut only after a differential parity gate shows identical findings per file, line and rule; gaps are fixed, kept in the companion, or recorded as an accepted gap in an ADR. The oxc packages are a Toolchain pin group.

## Consequences

- Fast default feedback with no loss of rule coverage.
- Two tools run in the same hook and CI step while the companion exists; its rule list shrinks as Oxlint grows.
- The parity gate is permanent maintenance and re-runs on Oxc bumps.
- The `oxc` Module declares `lint` and `format` with Cardinality one, so alternatives conflict through Capabilities, not special rules.

## Alternatives considered

- **ESLint and a separate formatter as the default**: rejected because it diverges from the four-repo consensus recorded in the standard.
- **Oxc only, dropping rules Oxlint lacks**: rejected because it relaxes rules to pass, which the standard forbids.
- **Trusting `@oxlint/migrate` output as is**: rejected because broken configs have been observed.
