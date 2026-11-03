# Layouts

A Layout is the mapping from Targets to paths for one Project. aokit supports two: `single` (one package) and `monorepo`. The monorepo is optional: the user chooses the Layout at `create`, and no Module may force it. Overview: [overview](overview.md). How Modules declare Targets: [Module contract](module-contract.md).

## Rules

- The user chooses the Layout. A simple landing page stays `single`.
- No Module can require a monorepo. `requires` accepts Capabilities and Extension points only ([Capabilities](capabilities.md)), so there is nothing to express "needs `monorepo`". A Module that mostly helps with several packages (for example `turborepo`) must still produce a valid Project on a `single` Layout, or be a no-op there that the Plan reports.
- Modules write to Targets, never to paths. The Layout resolves each Target to a directory when the [Engine](engine.md) builds the Plan.
- The chosen Layout is recorded in the Lockfile, so `add`, `update` and `remove` resolve Targets the same way later.

## Targets

A Target is a logical destination. Built-in Targets:

| Target | Holds |
| --- | --- |
| `root` | Repository-level files: `package.json` of the workspace root, lint and format config, `.gitignore`, `AGENTS.md`. |
| `web` | A user-facing front end (Next, Vite, Astro). |
| `server` | A back end or API (Hono). |
| `db` | Schema, migrations and the database client. |
| `shared-ui` | Reusable UI components. |
| `config` | Shared tool configuration (TypeScript base config, Oxc config). |

A base Module may declare more Targets; they must also be resolvable by both Layouts.

## Resolution tables

`single`: every Target resolves into one package. Directories keep the Targets separate when two Modules would otherwise collide.

| Target | Path |
| --- | --- |
| `root` | `./` |
| `config` | `./` |
| `web` | `./src/` (for a framework with its own source dir, `./`) |
| `server` | `./src/server/` |
| `db` | `./src/db/` |
| `shared-ui` | `./src/components/` |

`monorepo`: each Target that holds code becomes a workspace package, with Bun workspaces and a Catalog at the root.

| Target | Path |
| --- | --- |
| `root` | `./` |
| `config` | `./packages/config/` |
| `web` | `./apps/web/` |
| `server` | `./apps/server/` |
| `db` | `./packages/db/` |
| `shared-ui` | `./packages/ui/` |

The Layout also decides cross-Target wiring that a Module should not care about: in `monorepo`, a dependency on another Target becomes a workspace dependency; in `single`, it becomes a relative import path. Modules express the intent (`target: "db"`) and the Layout produces the form.

If a Module writes to a Target that the selected Layout cannot resolve, the Resolver fails with an error that names the Target and lists the Modules that provide it; this does not change the Layout.

## `layout migrate`

`aokit layout migrate <single|monorepo>` is optional and explicit. It builds a Plan in the VFS that moves each Target's files from the old paths to the new ones (rename changes with provenance), rewrites workspace manifests and the Lockfile's Layout, and then goes through the usual [Plan-before-apply](engine.md#vfs-and-plan-before-apply) sequence, including `--dry-run` and `--diff`. Files the user edited keep their edits: the migration is a rename plus a 3-way merge, like any update. It is never run implicitly.

## Separate repositories

Separate repositories are separate Projects, each with its own Lockfile and Layout. Integration between them (shared packages, cross-repo contracts, coordinated releases) is out of scope and is not documented.
