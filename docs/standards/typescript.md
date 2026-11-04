# TypeScript

Projects carry two TypeScript versions: a real 6.x for every tool that needs the TypeScript JavaScript API, and 7 for the fast compiler. Related: [tooling](tooling.md), [renovate](renovate.md), index in [standards](README.md).

## Dual layout

| Dependency | Resolves to | Used for |
| --- | --- | --- |
| `typescript` | Real TypeScript 6.x, through the `@typescript/typescript6` alias or the [Catalog](../../GLOSSARY.md) | Everything that imports the TypeScript API: typescript-eslint, ts-morph, `astro check`, editors. |
| `typescript7` | Exact alias to `typescript@7.1.0-beta` | The `tsc` compiler for type checking and builds. |

`typescript7` is the single alias name in every standard and every Module. The `typescript7` alias is part of a Toolchain pin group: exact version, never automerged ([renovate](renovate.md)).

```json
{
  "devDependencies": {
    "typescript": "npm:@typescript/typescript6@6.0.2",
    "typescript7": "npm:typescript@7.1.0-beta"
  }
}
```

The versions shown are the ones current at the time of writing; the Catalog is the source for the live values.

## Explicit bin and version test

Under Bun, `node_modules/.bin/tsc` may resolve to the 6.x package, not to the alias. Therefore:

- Scripts never call bare `tsc`. They call the bin of the `typescript7` package explicitly, by its path under `node_modules/typescript7/`, never through `node_modules/.bin/tsc`.
- A test asserts `--version` of the alias bin starts with `7.`. It fails the build when the wrong compiler is resolved, so a silent fallback to 6.x cannot pass.

## TypeScript 7 and the API

TypeScript 7 has no classic JavaScript API. Tooling that uses the API (typescript-eslint type-aware rules in the ESLint companion, ts-morph, the Astro language tools) targets TypeScript 6. Oxlint `--type-aware` uses its own type-checking backend and does not need the API. Optional tools that need the API, such as ts-morph in the aokit engine, load lazily so a Project without them never pays for them.

## Astro

- Type checking for Astro runs `astro check` on TypeScript 6.
- The TypeScript 7 content mapper for Astro is **optional per repo**, not part of the standard. It produced false errors on a current Astro release and stays out of the default until TypeScript 7 is stable.
- `tsc` from `typescript7` still checks the `.ts` and `.tsx` sources.

## Strictness

All Projects use strict TypeScript. The shared base config lives in the `config` Target, and each Project extends it. Settings are tightened, never loosened, to pass a check.
