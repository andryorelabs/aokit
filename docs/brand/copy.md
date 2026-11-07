# Copy

The approved strings for every public surface, copied verbatim from the approved [copy exploration](explorations/copy.html) and the brand kit spec. Other files copy from this page; they do not reword it. Rules are in [voice.md](voice.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Brand line

```text
Projects from Modules. Updates that merge.
```

Used on the cover and the banner, with the plain line under it. Never the h1.

## Plain line

```text
A Bun-only CLI that creates TypeScript projects from composable Modules.
```

## README top

The README opens with `# aokit`, the cover, the bold brand line, the badge row, and this intro:

```text
aokit is a Bun-only CLI that creates TypeScript projects from composable Modules and keeps them up to date. A Lockfile stores a hash for every generated file, so an update merges with your edits and never overwrites them.
```

Quickstart:

```text
Run `bunx aokit create my-app`, pick your Modules, and start the dev server.
```

```sh
bunx aokit create my-app
cd my-app && bun run dev
```

What you get, six bullets:

- **Pick Modules, get a project.** `aokit create` generates a TypeScript project from Modules such as hono, vite-react, tailwind4, oxc, docker, knip, coolify and catalog.
- **Updates keep your edits.** The Lockfile records a hash for every file, and `aokit update` merges changes with what you wrote.
- **See changes before they land.** `aokit diff` and `aokit check` show what would change.
- **Bun only.** aokit supports Bun and no other package manager.
- **Works inside coding agents.** `aokit mcp init` registers the aokit MCP server in Claude, Cursor, VS Code or Codex.
- **No telemetry.** The CLI, the MCP server and generated projects send no usage data.

## GitHub About

```text
Bun-only CLI that creates TypeScript projects from composable Modules and keeps them updatable: a Lockfile with per-file hashes lets updates merge with your edits.
```

Homepage:

```text
https://github.com/andryorelabs/aokit#readme
```

Topics: `cli`, `bun`, `typescript`, `scaffolding`, `project-generator`, `codegen`, `mcp`.

## Package metadata

| Package         | Description                                                              | Keywords                                                          |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `aokit`         | Create and update TypeScript projects from composable Modules. Bun only. | aokit, bun, cli, scaffolding, generator, typescript, modules, mcp |
| `create-aokit`  | Scaffold a new aokit project with bun create aokit.                      | aokit, create, bun, scaffolding, typescript                       |
| `@aokit/module` | The Module manifest contract for aokit Module authors.                   | aokit, module, manifest, typescript                               |

Fields shared by all three: `homepage` `https://github.com/andryorelabs/aokit#readme`, `bugs` `https://github.com/andryorelabs/aokit/issues`, `repository` `git+https://github.com/andryorelabs/aokit.git` with the package `directory`, and `author` `Andry Orellana`.

## llms.txt and CLI

The `llms.txt` blockquote stays as it is in the repository:

```text
aokit is a Bun-only CLI that creates and evolves TypeScript Projects from composable Modules served by Registries. It keeps a Lockfile with per-file hashes so updates merge with your edits instead of overwriting them.
```

The CLI help description and banner line:

```text
aokit  Projects from Modules. Updates that merge.
```

## Claims checked

A claim stays public only while its source holds. Each row names a command, an ADR or a file.

| Claim                                                                               | Source                                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Bun-only CLI                                                                        | [ADR 0006](../adr/0006-bun-only.md)                                                           |
| Creates TypeScript projects from composable Modules                                 | [CLI reference](../reference/cli.md), `create`; [GLOSSARY.md](../../GLOSSARY.md), Module      |
| Modules: hono, vite-react, tailwind4, oxc, docker, knip, coolify, catalog           | `ls registry-src/`, the eight first-party Modules                                             |
| A Lockfile stores a hash for every generated file                                   | [Lockfile](../architecture/lockfile.md); `llms.txt`                                           |
| An update merges with your edits and never overwrites them                          | [CLI reference](../reference/cli.md), `update`; `llms.txt`                                    |
| `aokit diff` and `aokit check` show what would change                               | [CLI reference](../reference/cli.md), `diff` and `check`                                      |
| `aokit mcp init` registers the aokit MCP server in Claude, Cursor, VS Code or Codex | [CLI reference](../reference/cli.md), `mcp init --client`; `packages/aokit/src/mcp/server.ts` |
| No usage data is sent by the CLI, the MCP server or generated projects              | [ADR 0013](../adr/0013-no-telemetry-in-v1.md)                                                 |
| Registries are versioned and integrity-checked                                      | [Registry](../architecture/registry.md); [GLOSSARY.md](../../GLOSSARY.md), Registry           |
| Updates keep a Project updatable after creation                                     | [ADR 0016](../adr/0016-update-moves-a-project-between-releases.md)                            |
