# Module catalog

An illustrative catalog of candidate [Modules](../../CONTEXT.md), derived from what the current reference projects actually use. It is **not a roadmap**: it shows how real usage maps onto [Capabilities](capabilities.md) and [Extension points](capabilities.md#extension-points), and it is a worked test of the [Module contract](module-contract.md). Which Modules ship, and in what order, is decided in the roadmap, not here.

## Scope and filter

Only current best practice is listed:

- UI primitives are shadcn on Base UI. There is no Radix Module.
- The CLI and generated Projects are Bun-only. There is no other package-manager Module and no alternative catalog path; Bun catalogs apply to the `monorepo` [Layout](layouts.md) only.
- Tooling follows the Oxc standard in [tooling](../standards/tooling.md); the other [standards](../standards/README.md) apply as well.
- Legacy repositories are not copy sources. Python, C++ and Swift stacks are out of scope.

## How to read the table

- Capability names follow [Capabilities](capabilities.md#naming): kebab-case, optionally namespaced with `:`. Names that appear in [the Cardinality table](capabilities.md#cardinality) (`orm`, `lint`, `format`, `deploy`) are normative; the others are illustrative proposals that the first-party Registry would own.
- **Cardinality** is declared where the Capability is provided. `1` means at most one provider per Project; `many` means any number.
- `requires` lists Capabilities and Extension points (`ext:<name>@<range>`). No row requires a Layout.
- **Contributes to** lists the Extension points the Module uses through [Ops](engine.md#ops-catalog); **declares** lists the ones it owns as a base Module. Extension point names are illustrative.
- The first Modules to ship fix their Anchors ([ADR 0014](../adr/0014-extension-point-anchors-are-identifier-names.md)): `vite-react` declares `web.providers` (`providers` in `src/providers.tsx`) and `web.routes` (`routes` in `src/routes.tsx`); `hono` declares `server.middleware` (`middleware`) and `server.routes` (`routes`) in `src/app.ts` of the `server` package; `oxc` declares `lint.ignores` as a `json` Extension point in `.oxlintrc.json` with the pointer `/ignorePatterns`.

## Application bases

| Module | Provides (Cardinality) | Requires | Declares / contributes to |
| --- | --- | --- | --- |
| `next` | `web` (1), `web:ssr` (1) | none | declares `web.providers`, `web.layout`, `web.routes` on target `web` |
| `vite-react` | `web` (1), `web:spa` (1) | none | declares `web.providers`, `web.routes` on target `web` |
| `astro` | `web` (1), `web:ssr` (1) | none | declares `web.integrations`, `web.layout` on target `web` |
| `hono` | `server` (1), `api:http` (1) | none | declares `server.middleware`, `server.routes` on target `server` |
| `tsdown` | `bundler` (1) | `server` | contributes to `server.build` (declared by `hono`) |

`next`, `vite-react` and `astro` all provide `web` with Cardinality one, so a Project has one front-end framework. `hono` is bundled with `tsdown` for publishable servers and libraries; they are two Modules because `tsdown` can serve other bases.

## Data, auth, environment and jobs

| Module | Provides (Cardinality) | Requires | Declares / contributes to |
| --- | --- | --- | --- |
| `prisma` | `orm` (1), `db:postgres` (1) | none | declares `db.schema` on target `db`; contributes to `env.schema` (`DATABASE_URL`) |
| `better-auth` | `auth` (1) | `orm`, `ext:web.providers@^1`, `ext:server.routes@^1` | contributes to `web.providers`, `server.routes`, `env.schema`, `db.schema` |
| `t3-env` | `env:validation` (1) | none | declares `env.schema` on target `config`; other Modules add keys there |
| `dotenvx` | `env:encryption` (1) | none | contributes to `env.schema` file handling (`.env` files, scripts) |
| `trigger.dev` | `jobs` (1) | `ext:env.schema@^1` | contributes to `env.schema`; declares `jobs.tasks` on target `server` |
| `posthog` | `analytics` (1) | `web`, `ext:web.providers@^1`, `ext:env.schema@^1` | contributes to `web.providers`, `env.schema` |
| `next-intl` | `i18n` (1) | `ext:web.providers@^1`, `ext:web.routes@^1` | contributes to `web.providers`, `web.routes` |
| `resend` | `email:send` (1) | `ext:env.schema@^1` | contributes to `env.schema` |
| `react-email` | `email:templates` (1) | `email:send` | declares `email.templates` on target `server` |

Notes:

- `prisma` provides both `orm` and `db:postgres` because a namespaced name never implies the bare one ([Naming](capabilities.md#naming)). A Module that only needs a Postgres database requires `db:postgres`.
- `better-auth` requires `orm`, not `prisma`; any Module providing `orm` satisfies it.
- `t3-env` and `dotenvx` are independent. Projects that need server environment validation select `t3-env`, usually with `dotenvx`; neither requires the other. `env.schema` is an Extension point that `t3-env` declares, so Modules that add environment keys depend on the point and not on `env.ts`.
- `next-intl` requires the `web.routes` Extension point of a base that declares it, so it is selectable with `next` and not with a base that lacks the point.

## UI and styling

| Module | Provides (Cardinality) | Requires | Declares / contributes to |
| --- | --- | --- | --- |
| `base-ui` | `ui:primitives` (1) | `web` | declares `ui.primitives` on target `shared-ui` |
| `shadcn` | `ui:components` (1) | `ui:primitives`, `styling`, `ext:web.layout@^1` | contributes to `web.layout`; consumes the shadcn [Registry](../../CONTEXT.md) adapter |
| `tailwind4` | `styling` (1) | `web` | declares `styles.theme` on target `web`; uses the `addCssAtRule` Op |

`shadcn` is always on Base UI. `base-ui` and `shadcn` are separate Modules so the primitives can be used without the component set. The shadcn lint rules ship with `shadcn`'s tooling files, not as a separate Module.

## Deployment

| Module | Provides (Cardinality) | Requires | Declares / contributes to |
| --- | --- | --- | --- |
| `docker` | `deploy` (many), `container` (1) | none | contributes to `env.schema` for build args |
| `coolify` | `deploy` (many) | `container` | contributes to `root` files only |

`deploy` has Cardinality many, so `docker` and `coolify` coexist ([Capabilities](capabilities.md#cardinality)). `coolify` deploys a container image, so it requires `container` and does not care which base produced the image.

## Quality and tooling

| Module | Provides (Cardinality) | Requires | Declares / contributes to |
| --- | --- | --- | --- |
| `oxc` | `lint` (1), `format` (1) | none | declares `lint.ignores`; see the worked example in [Module contract](module-contract.md#worked-example-oxc) |
| `eslint` companion | `lint:companion` (many) | `lint` | contributes to `lint.ignores`; runs the full project rule set on `**/*.astro` and the type-aware rules Oxlint cannot run |
| `commitlint` | `commit-lint` (1) | `git-hooks` | contributes to `git.hooks` |
| `husky` | `git-hooks` (1) | none | declares `git.hooks` on target `root` |
| `lint-staged` | `staged-checks` (1) | `git-hooks`, `lint`, `format` | contributes to `git.hooks` |
| `knip` | `unused-code` (1) | none | contributes to `lint.ignores` |
| `playwright` | `e2e` (1) | `web` | declares `test.e2e` on target `web` |
| `axe` | `a11y-test` (1) | `e2e` | contributes to `test.e2e` |
| `vitest` | `test-runner` (1) | none | declares `test.unit` |
| `bun-test` | `test-runner` (1) | none | declares `test.unit` |
| `turborepo` | `task-runner` (1) | none | declares `workspace.tasks` on target `root` |
| `catalog` | `dep-catalog` (1) | `task-runner` | contributes to `workspace.tasks`; writes the Bun catalog |
| `renovate` | `dep-updates` (1) | none | contributes to `root` files only |
| `adr-docs` | `docs:adr` (1) | none | declares `docs.index`; writes `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, skills |

Notes:

- `oxc` provides `lint` and `format`, both at most one, so it excludes any other formatter or linter Module. The `eslint` companion provides `lint:companion` (a distinct Capability, many) and therefore does not collide with `oxc`'s `lint`. It exists because Oxlint cannot lint `.astro` templates and cannot run some type-aware rules; see [tooling](../standards/tooling.md#the-eslint-companion).
- `vitest` and `bun-test` both provide `test-runner` with Cardinality one: a Project picks exactly one, per Project, and no Module may require a specific one. Modules that need to run tests require the Capability.
- `turborepo` and `catalog` are only meaningful in a `monorepo` Layout. Neither requires it ([Capabilities](capabilities.md#deriving-compatibility)); the user's Layout choice decides whether their Targets exist, and the Layout rules in [Layouts](layouts.md) govern what happens in `single`.
- `renovate` ships the configuration described in [renovate](../standards/renovate.md), including the Toolchain pin groups.
- `adr-docs` backs the conventions in [docs and forge](../standards/docs-and-forge.md).

## Consistency checks

Every row above should satisfy, and a reviewer can check mechanically:

1. All `requires` entries name a Capability or an `ext:` point that some other row provides or declares.
2. No two rows provide the same Capability with Cardinality one unless they are alternatives for the same slot (`next`/`vite-react`/`astro` for `web`; `vitest`/`bun-test` for `test-runner`).
3. No row mentions a Layout as a requirement.
4. No row targets another package manager, Radix, or a non-TypeScript stack.
