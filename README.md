# aokit

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/og/cover.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/brand/og/cover-light.png">
    <img alt="aokit" src="docs/brand/og/cover.png" width="720">
  </picture>
</p>

<p align="center"><strong>Projects from Modules. Updates that merge.</strong></p>

<p align="center">
  <a href="https://github.com/andryorelabs/aokit/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/andryorelabs/aokit/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

aokit is a Bun-only CLI that creates TypeScript projects from composable Modules and keeps them up to date. A Lockfile stores a hash for every generated file, so an update merges with your edits and never overwrites them.

## Quickstart

Run `bunx aokit create my-app`, pick your Modules, and start the dev server.

```sh
bunx aokit create my-app
cd my-app && bun run dev
```

## What you get

- **Pick Modules, get a project.** `aokit create` generates a TypeScript project from Modules such as next, vite-react, astro, hono, prisma, better-auth, tailwind4, shadcn, oxc, docker and coolify. `eslint-react`, `vitest-react`, `msw`, `hono-zod-validator`, `next-themes` and `fontsource` and `shadcn-lint` are Pending until the next Release. The full list is in the [Module catalog](docs/architecture/module-catalog.md).
- **Updates keep your edits.** The Lockfile records a hash for every file, and `aokit update` merges changes with what you wrote.
- **See changes before they land.** `aokit diff` and `aokit check` show what would change.
- **Bun only.** aokit supports Bun and no other package manager.
- **Works inside coding agents.** `aokit mcp init` registers the aokit MCP server in Claude, Cursor, VS Code or Codex.
- **No telemetry.** The CLI, the MCP server and generated projects send no usage data.

The design is in [`docs/`](docs/): start with the [roadmap](docs/roadmap.md), the [architecture overview](docs/architecture/overview.md) and the [glossary](GLOSSARY.md).

## Workspace

A Bun workspace with three packages:

| Package         | Path                    | Contents                                                     |
| --------------- | ----------------------- | ------------------------------------------------------------ |
| `aokit`         | `packages/aokit`        | The CLI (bin `aokit`) and the core, one entry per subsystem. |
| `create-aokit`  | `packages/create-aokit` | The `create-aokit` bin that runs `aokit create`.             |
| `@aokit/module` | `packages/module`       | The Module manifest contract used by Module authors.         |

## Development

Bun is the only supported package manager ([ADR 0006](docs/adr/0006-bun-only.md)).

```sh
bun install --frozen-lockfile
bun run check   # TypeScript 7 type check, oxlint --type-aware, oxfmt --check, knip
bun run test    # bun test
bun run lint    # oxlint --type-aware
bun run format  # oxfmt
```

Tooling follows [`docs/standards`](docs/standards/README.md): Oxfmt and Oxlint (exact `oxc` pin group), TypeScript 6 for API consumers plus the exact `typescript7` alias for type checking, husky with lint-staged and commitlint (conventional commits, gitmoji optional), and knip. Source comments are TSDoc blocks only, enforced by the `local/no-non-doc-comments` Oxlint jsPlugin in [`tools/oxlint`](tools/oxlint/local-plugin.ts).

## Contributing

Agents start at [AGENTS.md](AGENTS.md). Contributors read [CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SUPPORT.md](SUPPORT.md), the [roadmap](ROADMAP.md) and the [blame ignore list](.git-blame-ignore-revs).

## Licence

[MIT](LICENSE)
