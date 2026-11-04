# aokit

aokit generates and maintains Projects from composable Modules. The design is in [`docs/`](docs/): start with the [roadmap](docs/roadmap.md), the [architecture overview](docs/architecture/overview.md) and the [glossary](GLOSSARY.md).

## Workspace

A Bun workspace with two packages:

| Package         | Path              | Contents                                                     |
| --------------- | ----------------- | ------------------------------------------------------------ |
| `aokit`         | `packages/aokit`  | The CLI (bin `aokit`) and the core, one entry per subsystem. |
| `@aokit/module` | `packages/module` | The Module manifest contract used by Module authors.         |

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

## License

[MIT](LICENSE)
