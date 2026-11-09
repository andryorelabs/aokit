# Module catalog

The first-party [Modules](../../GLOSSARY.md) in `registry-src/`, with the [Capabilities](capabilities.md) and [Extension points](capabilities.md#extension-points) each one declares in its manifest. It is a worked test of the [Module contract](module-contract.md). The tables list every Module in `registry-src/`, released or Pending; the manifests are the source of truth, and this page follows them. [Pending Modules](#pending-modules) are listed separately.

## Scope and filter

Only current best practice is listed:

- UI primitives are shadcn on Base UI. There is no Radix Module.
- The CLI and generated Projects are Bun-only. There is no other package-manager Module and no alternative catalog path; Bun catalogs apply to the `monorepo` [Layout](layouts.md) only.
- Tooling follows the Oxc standard in [tooling](../standards/tooling.md); the other [standards](../standards/README.md) apply as well.
- Legacy repositories are not copy sources. Python, C++ and Swift stacks are out of scope.

## How to read the table

- Capability names follow [Capabilities](capabilities.md#naming): kebab-case, optionally namespaced with `:`. Names that appear in [the Cardinality table](capabilities.md#cardinality) (`orm`, `lint`, `format`, `deploy`) are normative; the others are owned by the first-party Registry.
- **Cardinality** is declared where the Capability is provided. `1` means at most one provider per Project; `many` means any number.
- `requires` lists Capabilities and Extension points (`ext:<name>@<range>`). No row requires a Layout.
- **Declares** lists the Extension points a Module owns, with its Target. **Contributes to** lists the Extension points it uses through [Ops](engine.md#ops-catalog). Extension points that no Module uses are not declared.
- Modules that add environment keys list them in their manifest `env` field.
- The first Modules to ship fix their Anchors ([ADR 0014](../adr/0014-extension-point-anchors-are-identifier-names.md)): `vite-react` declares `web.providers` (`providers` in `src/providers.tsx`) and `web.routes` (`routes` in `src/routes.tsx`); `hono` declares `server.middleware` (`middleware`) and `server.routes` (`routes`) in `src/app.ts` of the `server` package; `oxc` declares `lint.ignores` as a `json` Extension point in `.oxlintrc.json` with the pointer `/ignorePatterns`.

## Application bases

| Module               | Provides (Cardinality)                                          | Requires               | Declares / contributes to                                                                        |
| -------------------- | --------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `next`               | `web` (1), `web:ssr` (1), `web:react` (1), `web:app-router` (1) | none                   | declares `web.providers`, `web.styles`, `next.config`, `next.plugins` on target `web`            |
| `vite-react`         | `web` (1), `web:spa` (1), `web:react` (1), `web:static` (1)     | none                   | declares `vite.plugins`, `web.styles`, `web.providers`, `web.routes` on target `web`             |
| `astro`              | `web` (1), `web:react` (1), `web:static` (1)                    | none                   | declares `astro.integrations`, `vite.plugins`, `web.styles` on target `web`                      |
| `hono`               | `server` (1), `api:http` (1)                                    | none                   | declares `server.middleware`, `server.routes` on target `server`                                 |
| `hono-rpc`           | `api:rpc` (1)                                                   | `ext:server.routes@^1` | seeds a typed client on target `api-client`                                                      |
| `hono-zod-validator` | none                                                            | `ext:server.routes@^1` | contributes to `server.routes`: a sample `/echo` route validated with `zValidator`               |
| `tsdown`             | `library` (1)                                                   | none                   | standalone library bundler on target `lib`, with a `size-limit` check; does not require `server` |
| `wxt`                | `extension` (1)                                                 | none                   | browser extension base (background, popup)                                                       |

`next`, `vite-react` and `astro` all provide `web` with Cardinality one, so a Project has one front-end framework. Their `web:*` flavors let a Module narrow what it needs: `web:app-router` is `next` only, `web:spa` is `vite-react` only, `web:static` is `vite-react` or `astro`. `tsdown` is independent of `hono` and of every `web` base; it builds publishable libraries and CLIs.

## Web features

| Module             | Provides (Cardinality) | Requires                                                        | Declares / contributes to                                                                   |
| ------------------ | ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `tailwind4`        | `styling` (1)          | `web`, `ext:web.styles@^1`                                      | declares `styles.theme` on target `web`; contributes to `web.styles`                        |
| `base-ui`          | `ui:primitives` (1)    | `web:react`                                                     | none                                                                                        |
| `shadcn`           | `ui:components` (1)    | `ui:primitives`, `styling`, `web:react`, `ext:styles.theme@^1`  | contributes to `styles.theme`                                                               |
| `tanstack-router`  | `routing` (1)          | `web:spa`, `ext:vite.plugins@^1`                                | contributes to `vite.plugins`                                                               |
| `tanstack-form`    | `forms` (1)            | `web:react`                                                     | none                                                                                        |
| `tanstack-table`   | `data-table` (1)       | `web:react`                                                     | none                                                                                        |
| `tanstack-virtual` | `virtualization` (1)   | `web:react`                                                     | none                                                                                        |
| `nuqs-next`        | `url-state` (1)        | `web:app-router`, `ext:web.providers@^1`                        | contributes to `web.providers`                                                              |
| `nuqs-vite`        | `url-state` (1)        | `web:spa`, `ext:web.providers@^1`                               | contributes to `web.providers`                                                              |
| `next-intl`        | `i18n` (1)             | `web:app-router`, `ext:next.plugins@^1`, `ext:web.providers@^1` | contributes to `next.plugins`, `web.providers`                                              |
| `posthog`          | `analytics` (1)        | `web:app-router`, `ext:web.providers@^1`                        | contributes to `web.providers`; env `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`   |
| `starlight`        | `docs-site` (1)        | `ext:astro.integrations@^1`                                     | contributes to `astro.integrations`                                                         |
| `next-themes`      | none                   | `web:app-router`, `ext:web.providers@^1`                        | contributes to `web.providers` (a `ThemeProvider`)                                          |
| `fontsource`       | none                   | `ext:web.styles@^1`                                             | contributes to `web.styles`: side-effect imports of the Geist and Geist Mono variable fonts |

Notes:

- `shadcn` is always on Base UI. `base-ui` and `shadcn` are separate Modules so the primitives can be used without the component set. The shadcn lint rules ship as the separate `shadcn-lint` Module (Pending, see [Quality and tooling](#quality-and-tooling)), so `shadcn` itself needs no lint dependency.
- `nuqs-next` and `nuqs-vite` both provide `url-state` with Cardinality one and differ by the `web:*` flavor they require, so each is selectable with exactly one kind of base.
- `next-intl` translates without locale-prefixed routes. It requires `web:app-router` and the `next.plugins` and `web.providers` Extension points that `next` declares, so it is selectable with `next` and not with a base that lacks them.
- `posthog` is Next only in v1.
- `next-themes` is Next only: it requires `web:app-router` and registers a client `ThemeProvider` through `web.providers`.
- `fontsource` self-hosts Geist and Geist Mono and imports both for their side effects through `web.styles`, so it works with any base that declares that point. Other families are added by hand.

## Data, auth, environment, email and jobs

| Module             | Provides (Cardinality)      | Requires                                           | Declares / contributes to                                               |
| ------------------ | --------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `prisma`           | `orm` (1), `orm:prisma` (1) | none                                               | declares `db.schema` on target `db`; env `DATABASE_URL`                 |
| `postgres-compose` | `db:postgres` (1)           | none                                               | Docker Compose Postgres service; env `DATABASE_URL`                     |
| `better-auth`      | `auth` (1)                  | `orm:prisma`, `web:app-router`, `ext:db.schema@^1` | contributes to `db.schema`; env `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` |
| `t3-env`           | `env:validation` (1)        | none                                               | declares `env.server`, `env.client` on target `config`                  |
| `dotenvx`          | `env:encryption` (1)        | none                                               | seeds `.env.example`; no Extension points                               |
| `trigger-dev`      | `jobs` (1)                  | none                                               | env `TRIGGER_SECRET_KEY`                                                |
| `resend`           | `email:send` (1)            | none                                               | env `RESEND_API_KEY`                                                    |
| `react-email`      | `email:templates` (1)       | none                                               | email templates and a preview script; independent of `resend`           |

Notes:

- `prisma` provides `orm` and the flavor `orm:prisma`, because a namespaced name never implies the bare one ([Naming](capabilities.md#naming)). It does not provide `db:postgres`: Prisma works against any `DATABASE_URL`, including hosted Postgres. `postgres-compose` provides `db:postgres`, and a Module that needs a local Postgres requires that Capability.
- `better-auth` requires `orm:prisma`, not `prisma`, and the `db.schema` Extension point that `prisma` declares; it adds its models through that point. It is Next only (`web:app-router`).
- `t3-env` and `dotenvx` are independent; neither requires the other.
- `resend` and `react-email` are two Modules so each is usable alone; `react-email` does not require `resend`.

## Deployment

| Module          | Provides (Cardinality)           | Requires     | Declares / contributes to             |
| --------------- | -------------------------------- | ------------ | ------------------------------------- |
| `docker`        | `deploy` (many), `container` (1) | none         | Dockerfile and `.dockerignore`        |
| `docker-static` | `deploy` (many), `container` (1) | `web:static` | Dockerfile that serves a static build |
| `coolify`       | `deploy` (many)                  | `container`  | root files only                       |

`deploy` has Cardinality many, so `docker` and `coolify` coexist ([Capabilities](capabilities.md#cardinality)). `docker` and `docker-static` both provide `container` with Cardinality one, so a Project picks one. `coolify` deploys a container image, so it requires `container` and does not care which Module produced it.

## Quality and tooling

| Module         | Provides (Cardinality)                      | Requires                               | Declares / contributes to                                                                                                                                                    |
| -------------- | ------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oxc`          | `lint` (1), `format` (1)                    | none; conflicts with `eslint-prettier` | declares `lint.ignores` on target `config`; ships `oxlint-tsgolint` for type-aware rules; see the worked example in [Module contract](module-contract.md#worked-example-oxc) |
| `eslint`       | `lint:companion` (many)                     | `lint`, `ext:lint.ignores@^1`          | declares `eslint.configs` on target `root`; contributes to `lint.ignores`; runs the full project rule set on `**/*.astro` and the type-aware rules Oxlint cannot run         |
| `eslint-react` | none                                        | `web:react`, `ext:eslint.configs@^1`   | contributes to `eslint.configs`: `jsx-a11y`, `react-hooks` and `@eslint-react` rules                                                                                         |
| `shadcn-lint`  | none                                        | `ui:components`, `lint`                | Oxlint config with the `@shadcn/lint` JS plugin on target `config`; script `lint:shadcn`                                                                                     |
| `knip`         | `unused-code` (1)                           | `ext:lint.ignores@^1`                  | contributes to `lint.ignores`                                                                                                                                                |
| `husky`        | `git-hooks` (1)                             | none                                   | Git hooks                                                                                                                                                                    |
| `commitlint`   | `commit-lint` (1)                           | `git-hooks`                            | commit message hook                                                                                                                                                          |
| `lint-staged`  | `staged-checks` (1)                         | `git-hooks`, `lint`, `format`          | pre-commit staged checks                                                                                                                                                     |
| `vitest`       | `test-runner` (1), `test-runner:vitest` (1) | none                                   | test runner with V8 coverage                                                                                                                                                 |
| `vitest-react` | none                                        | `web:react`, `test-runner:vitest`      | React component tests in happy-dom and in a real browser through Playwright, on target `web`; script `test:react`                                                            |
| `msw`          | none                                        | none                                   | Mock Service Worker handlers, Node server and a Vitest setup file                                                                                                            |
| `bun-test`     | `test-runner` (1)                           | none                                   | test runner                                                                                                                                                                  |
| `playwright`   | `e2e` (1)                                   | `web`                                  | end-to-end tests                                                                                                                                                             |
| `axe`          | `a11y-test` (1)                             | `e2e`                                  | accessibility checks on top of the `e2e` suite                                                                                                                               |
| `turborepo`    | `task-runner` (1)                           | none                                   | workspace task runner                                                                                                                                                        |
| `github-ci`    | `ci` (1)                                    | none                                   | GitHub Actions workflows, labels and templates                                                                                                                               |
| `renovate`     | `dep-updates` (1)                           | none                                   | root files only                                                                                                                                                              |
| `adr-docs`     | `docs:adr` (1)                              | none                                   | writes `docs/adr/`, `GLOSSARY.md` and its own skills, and contributes a Region to `AGENTS.md`                                                                                |
| `repo-docs`    | `repo-docs` (1)                             | none                                   | community and repository hygiene files                                                                                                                                       |

Notes:

- `oxc` provides `lint` and `format`, both at most one, so it excludes any other formatter or linter Module. The `eslint` companion provides `lint:companion` (a distinct Capability, many) and therefore does not collide with `oxc`'s `lint`. It exists because Oxlint cannot lint `.astro` templates and cannot run some type-aware rules; see [tooling](../standards/tooling.md#the-eslint-companion).
- `eslint` declares `eslint.configs` (a `region` Extension point named `configs` in `eslint.config.mjs`) so other Modules add ESLint flat configs without knowing the file; `eslint-react` is its first contributor and requires `web:react`. See [Extension points](capabilities.md#the-eslintconfigs-extension-point).
- `vitest` also provides the flavor `test-runner:vitest`, which `vitest-react` requires; `bun-test` does not provide it, so `vitest-react` is selectable only with `vitest`. `msw` has no requirements and ships a Vitest setup file (`src/mocks/vitest.setup.ts`) that its `agents` Region tells you to add to Vitest `setupFiles`.
- `vitest` and `bun-test` both provide `test-runner` with Cardinality one: a Project picks exactly one, and no Module may require a specific one. Modules that need to run tests require the Capability.
- `turborepo` is only meaningful in a `monorepo` Layout. It does not require it ([Capabilities](capabilities.md#deriving-compatibility)); the user's Layout choice decides whether its Targets exist, and the Layout rules in [Layouts](layouts.md) govern what happens in `single`. The dependency Catalog is not a Module; it comes from the Release Catalog ([ADR 0024](../adr/0024-pending-modules-catalog-fragments-and-release-cuts.md)).
- `renovate` ships the configuration described in [renovate](../standards/renovate.md), including the Toolchain pin groups.
- `adr-docs` backs the conventions in [docs and forge](../standards/docs-and-forge.md).

## Pending Modules

Modules added or bumped after Release `2026.12.0` are Pending until the next Release cut ([ADR 0024](../adr/0024-pending-modules-catalog-fragments-and-release-cuts.md)). Each carries a Catalog fragment (`registry-src/<module>/catalog.json`) listing only the dependencies the released Catalog lacks, and `registry/` is unchanged.

| Module               | Change          | Fragment adds                                                                                     |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `eslint-react`       | new, 1.0.0      | `@eslint-react/eslint-plugin`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`              |
| `vitest-react`       | new, 1.0.0      | `@vitest/browser-playwright`, `happy-dom`, `playwright`, `vitest-browser-react`                   |
| `msw`                | new, 1.0.0      | `msw`                                                                                             |
| `hono-zod-validator` | new, 1.0.0      | `@hono/zod-validator`                                                                             |
| `next-themes`        | new, 1.0.0      | `next-themes`                                                                                     |
| `fontsource`         | new, 1.0.0      | `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`                                   |
| `shadcn-lint`        | new, 1.0.0      | `@shadcn/lint`                                                                                    |
| `oxc`                | bumped to 1.2.0 | `oxlint-tsgolint`                                                                                 |
| `eslint`             | bumped to 1.1.0 | `@eslint-community/eslint-plugin-eslint-comments`, `eslint-plugin-jsdoc`, `eslint-plugin-unicorn` |
| `vitest`             | bumped to 1.1.0 | `@vitest/coverage-v8`                                                                             |
| `tsdown`             | bumped to 1.1.0 | `size-limit`, `@size-limit/file`                                                                  |

## Consistency checks

Every row above should satisfy, and a reviewer can check mechanically:

1. All `requires` entries name a Capability or an `ext:` point that some other row provides or declares.
2. No two rows provide the same Capability with Cardinality one unless they are alternatives for the same slot (`next`/`vite-react`/`astro` for `web`; `vitest`/`bun-test` for `test-runner`; `nuqs-next`/`nuqs-vite` for `url-state`; `docker`/`docker-static` for `container`).
3. No row mentions a Layout as a requirement.
4. No row targets another package manager, Radix, or a non-TypeScript stack.
