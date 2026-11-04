# 0014. Extension point anchors are identifier names

Status: Accepted (2026-11-03)
Revised: 2026-11-03 — `json` Extension points use JSON-pointer Anchors and data Ops can address an Extension point
Revised: 2026-11-04 — `region` Extension points cover Markdown and CSS files, not Markdown only
Revised: 2026-11-04 — the span parity test between native and WASM oxc-parser is dropped
Spec: S12 (Spec: aokit core, schema, VFS and engine ops)
Architecture: [Capabilities: extension points](../architecture/capabilities.md#extension-points), [Engine: locate and splice](../architecture/engine.md#code-edits-locate-and-splice)

## Context

An Extension point needs an Anchor the Engine can find after the user has edited the file. Module source files must stay plain, valid TypeScript ([no template engine](../architecture/engine.md#no-template-engine)), so the Anchor cannot require syntax that only aokit understands. [ADR 0010](0010-locate-and-splice-edit-engine.md) allows oxc-parser or ast-grep for the locate step but does not say what the Anchor looks like.

## Decision

For the TypeScript kinds (`array`, `object`, `import-list`) the Anchor is the name of a top-level declaration, such as `providers` in `export const providers = [...]`. The Engine locates it with oxc-parser and splices at the declaration's value. Marker comments are used only for `region` Extension points, which live in Markdown and in CSS files such as `src/styles.css`. oxc-parser is the only locate backend for now; ast-grep is added when an Op needs a structural pattern that a declaration name cannot express.

For `json` Extension points the Anchor is a JSON pointer (`/ignorePatterns`), because JSON has no identifiers. Data Ops (`mergeJson`, `mergeYaml`, `addEnv`, `addCssAtRule`, `appendRegion`) may name `extensionPoint` and `range` instead of `target` and `file`; the Engine then resolves the file and the pointer from the declaring Module, so a contributor never sees the path.

## Consequences

- Base Module files stay plain, lintable TypeScript with no marker noise.
- An Anchor survives reformatting and unrelated edits; renaming the declaration is a major change to the Extension point ([versioning rules](../architecture/capabilities.md#extension-points)).
- One parsing dependency in the first version. The binary and the npm package use the same native oxc-parser, so no span parity test between builds is needed.
- Anchors inside nested scopes are not supported; a base Module exposes the Extension point as a top-level declaration.

## Alternatives considered

- **Marker comments everywhere**: rejected because they add noise to plain files and are easy to delete by accident.
- **ast-grep patterns as the Anchor**: rejected because patterns are fragile across formatting and add a second dependency before an Op needs one.
