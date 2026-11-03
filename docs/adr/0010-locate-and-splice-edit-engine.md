# 0010. Locate-and-splice edit engine, magicast only for config objects

Status: Accepted (2026-11-03)
Spec: S3 (AO-2673)
Architecture: [Engine: locate and splice](../architecture/engine.md#code-edits-locate-and-splice)

## Context

Ops edit TypeScript the user may have changed. The edit mechanism must keep formatting and comments, compose edits from many Modules in one file, and be deterministic. Better-T-Stack uses ts-morph, which has a TypeScript 7 API gap ([engine research](../research/engine-and-registry.md)).

## Decision

Code edits locate a position with oxc-parser (AST and spans) or ast-grep (structural patterns), then splice text with magic-string against the original source. All edits to one file form one batch in original offsets, with overlap detection; same-offset inserts follow the canonical Module order. magicast is used only for config-shaped objects (`export default defineConfig({...})`). ts-morph is optional and lazy, for Modules that need type information, and runs on TypeScript 6. Non-TS files use dedicated patchers (jsonc-parser, `yaml` Document API, postcss, line-based `.env` that never overwrites keys, markdown marker regions). There is no template engine, only plain valid files with `{{var}}` and `__name__`.

## Consequences

- Untouched source stays byte-identical; the Plan shows minimal diffs.
- Overlapping edits fail loudly with both Modules named.
- The binary uses the WASM oxc-parser or ast-grep, and a hash test must show both builds produce the same spans.
- Edits that need semantic information require the optional ts-morph path.

## Alternatives considered

- **ts-morph as the default**: rejected because of the TypeScript 7 gap.
- **magicast for all edits**: rejected because it suits config objects, not general source.
- **Template engine with conditionals**: rejected, see [ADR 0002](0002-extension-points-and-declarative-ops.md).
