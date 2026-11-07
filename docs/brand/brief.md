# Brand brief

What aokit is, who it is for and how it presents itself. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The decisions behind it are in [ADR 0023](../adr/0023-brand-kit-in-docs-brand.md) and the [copy exploration](explorations/copy.html).

## Position

aokit is a Bun-only CLI that creates TypeScript Projects from composable Modules and keeps them updatable. Two facts carry the position, and both can be checked in the repository:

- A Project is composed from Modules, each declared as a manifest ([module contract](../architecture/module-contract.md)).
- A Lockfile records a hash for every generated file, so `aokit update` merges changes with the user's edits instead of overwriting them ([Lockfile](../architecture/lockfile.md), [CLI reference](../reference/cli.md)).

The brand line is "Projects from Modules. Updates that merge." The plain category line under it is "A Bun-only CLI that creates TypeScript projects from composable Modules." Both are fixed in [copy.md](copy.md).

## Audience

- TypeScript developers who start new services or apps with Bun and want the same stack choices in every Project.
- Teams that keep several Projects on one stack and need to roll stack changes into each of them without redoing local edits.
- Authors of Modules, who publish a manifest through a Registry ([module contract](../architecture/module-contract.md)).
- Coding agents, which drive the CLI and the MCP server through `aokit mcp init`.

## What aokit is

- A CLI with `create`, `add`, `remove`, `update`, `diff`, `check` and `mcp` ([CLI reference](../reference/cli.md)).
- A set of first-party Modules in `registry-src/`: hono, vite-react, tailwind4, oxc, docker, knip, coolify and catalog.
- A Registry protocol with integrity hashes and a trust gate ([Registry](../architecture/registry.md), [security](../security.md)).
- Bun only. No other package manager is supported ([ADR 0006](../adr/0006-bun-only.md)).
- Free of telemetry in v1 ([ADR 0013](../adr/0013-no-telemetry-in-v1.md)).

## What aokit is not

- Not a template gallery. A Module is a declarative manifest, not a copied folder of files.
- Not a runtime framework. aokit generates and updates files; it is not a dependency of the generated Project at run time.
- Not for other package managers.

## Personality

Plain, exact, quiet. The identity is Soot: dark first, one ink, no accent colour, Geist type, and a mark that shows a Module clicking into place. The voice rules are in [voice.md](voice.md); the name is explained in [naming.md](naming.md).

## What to avoid

- Hype and metaphors: no "supercharge", "magic" or "blazing".
- Claims without a source. Every public claim has a row in the "Claims checked" table of [copy.md](copy.md).
- Colours outside the Soot palette, and any accent colour.
- A tool name in any case other than lowercase `aokit`.
- Calling Modules plugins, presets or templates (see the Avoid lists in [GLOSSARY.md](../../GLOSSARY.md)).
- Promising dates for the roadmap. Planned work lives in the [roadmap](../roadmap.md).
