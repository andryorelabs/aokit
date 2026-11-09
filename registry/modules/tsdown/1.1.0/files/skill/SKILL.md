---
name: tsdown-library
description: Build, check and compile the library or CLI that tsdown packages. Use when changing its entry points, exports, build config or package checks.
---

# tsdown library

tsdown bundles the library to `dist/` as ESM with type declarations. The scripts are namespaced so the library can sit next to a web app in either Layout.

## Commands

- `bun run build:lib`: bundle `src/index.ts` to `dist/` with `tsdown`.
- `bun run check:package`: run `publint` and `@arethetypeswrong/cli` against the package. Run `build:lib` first; both check the built output.
- `bun run compile`: compile `src/cli.ts` into a standalone binary with `bun build --compile`.

## Key files

- `tsdown.config.ts`: entry points, format, declaration output. Add an entry here, then export it.
- `package.json`: `exports`, `main`, `types` and `files` describe the published surface. Keep them in step with the entries in `tsdown.config.ts`.
- `src/index.ts`: the public entry. Everything exported here is the library API.
- `src/cli.ts`: the binary entry used by `compile`. It is not part of the published bundle.

## Add an entry point

1. Create `src/<name>.ts` and give every exported function an explicit return type, because declarations are generated with an isolated-declarations transform.
2. Add `"src/<name>.ts"` to `entry` in `tsdown.config.ts`.
3. Add a matching `exports["./<name>"]` string pointing at `dist/<name>.mjs`; TypeScript finds the sibling `dist/<name>.d.mts`.
4. Run `bun run build:lib && bun run check:package`.

## Rules

- Publish ESM only. `check:package` runs with the `esm-only` profile.
- Never use `Bun` APIs in `src/index.ts`: the library must run on Node. Keep Bun-only code in `src/cli.ts`.
- Do not hand-edit `dist/`; it is cleaned and rebuilt on every build.
