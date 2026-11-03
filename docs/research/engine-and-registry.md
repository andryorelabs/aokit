# Engine and registry findings

Findings only. Decisions are in `docs/architecture/` (not yet written; links will be added once it exists). `raw-notes.md` = [raw-notes.md](raw-notes.md); line numbers refer to it. Findings come from the 2026-11-01 research (3 agents, context7 + web) unless stated.

## Code-editing libraries (TypeScript sources)

| Tool | Finding | Source |
| --- | --- | --- |
| magicast | Suited to config-shaped objects (e.g. a default-exported config), not general source edits | raw-notes.md L33; <https://github.com/unjs/magicast> |
| ts-morph | Full TypeScript AST manipulation; the notes flag a TypeScript 7 API gap, so it would have to be optional and lazily loaded. Better-T-Stack already uses it | raw-notes.md L26, L33; <https://github.com/dsherret/ts-morph> |
| ast-grep | Structural locate; usable to find edit positions | raw-notes.md L33; <https://ast-grep.github.io> |
| recast | Listed among the evaluated tools; no specific finding recorded in the notes (unverified beyond the name) | raw-notes.md L33 (via spec S1 list); <https://github.com/benjamn/recast> |
| oxc-parser + magic-string | Locate a node with oxc-parser (or ast-grep), then splice text with magic-string; supports batch edits expressed in original offsets and overlap detection | raw-notes.md L33; <https://oxc.rs>, <https://github.com/Rich-Harris/magic-string> |
| knitwork | Generating small code snippets | raw-notes.md L33; <https://github.com/unjs/knitwork> |

Additional notes: stable anchors at extension points are recommended by the research as the thing to locate (raw-notes.md L33). Native oxc in a Bun-compiled binary is a risk, see [cli-and-tooling.md](cli-and-tooling.md#bun---compile).

## Non-TypeScript patchers (raw-notes.md L34)

- `jsonc-parser` for `tsconfig` and other JSON-with-comments files: <https://github.com/microsoft/node-jsonc-parser>
- `sort-package-json` plus a structural merge for `package.json`: <https://github.com/keithamus/sort-package-json>
- `yaml` Document API for YAML (keeps comments): <https://github.com/eemeli/yaml>
- postcss for Tailwind v4 CSS entries (`@import`, `@plugin`, `@theme`): <https://postcss.org>
- Line-based `.env` editing that never overwrites existing keys (no library; a behaviour the research recommends)
- Markdown marker regions for generated sections in docs files

## Nx devkit `Tree` and Angular schematics

Source: raw-notes.md L35; <https://nx.dev/extending-nx/recipes/local-generators>, <https://angular.dev/tools/cli/schematics>.

Patterns the research highlights:

- An in-memory tree records a change list of create, update, delete and rename operations.
- Each change keeps provenance (which generator or step caused it).
- Conflicts fail by default.
- Commit is atomic (the notes describe temp directory then rename).
- A final, pinned format phase runs after all edits.

## shadcn registry

Source: raw-notes.md L37; <https://ui.shadcn.com/docs/registry>, <https://ui.shadcn.com/docs/registry/registry-item-json>.

- 12 item types.
- Alias placeholders in item file paths and content.
- Fields: `css`, `cssVars`, `envVars`, `font`, `base.config`.
- `registryDependencies` accepts 5 address forms.
- Namespaced registries with authentication headers.
- shadcn has no lockfile and no integrity hashes (raw-notes.md L37).

The notes list the counts but not the 12 type names or the 5 address forms; they are not enumerated here to avoid inventing them. Verify against the schema documentation above before relying on them.

## Determinism sources (raw-notes.md L38)

Things that make generation non-reproducible, and the countermeasures the research names:

- Iteration order: a canonical topological order with codepoint tie-break, and sorted emission.
- Concurrency: serial application of edits.
- Ambient values (time, randomness, environment): inject a context for `now`, `random`, `env`.
- Secrets and other volatile values: excluded from golden hashes.
- Line endings: LF.
- Formatter version drift: a pinned formatter.
- Installs: none during the deterministic phase.
- Verification: CI generates twice and compares hashes.

## Templating without an engine (raw-notes.md L36)

The research notes a design with plain valid source files, a minimal `{{var}}` substitution and `__name__` path interpolation, and with variants kept as separate files. Contrast: Better-T-Stack's Handlebars layering, see [scaffolding-landscape.md](scaffolding-landscape.md#better-t-stack).
