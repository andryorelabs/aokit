# Getting started

Create a Project from Modules, add a Module later, update it when a new Release lands and check its health. Every command is in the [CLI reference](../reference/cli.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

aokit is pre-1.0 (alpha). In 0.x a minor version may break; see [Stability](../stability.md).

## Prerequisites

- [Bun](https://bun.sh) 1.4.4 or newer on `PATH`. aokit supports Bun and no other package manager ([ADR 0006](../adr/0006-bun-only.md)).
- Git, for the clean-tree check that commands writing to a Project make.
- Without Bun, the [standalone binaries](../../README.md#install-the-binary) run the same CLI.

## Create a Project

```sh
bunx aokit create my-app
```

`create` asks for the Layout and the Modules, then writes the Project and runs `bun install`. The directory must be missing or empty. To skip the prompts, name everything on the command line:

```sh
bunx aokit create my-app --layout single --modules next,tailwind4,oxc
```

The [Module catalog](../architecture/module-catalog.md) lists every Module you can pick. To see what would be written before anything is, add `--dry-run` or `--diff`. `--no-install` skips the dependency install.

The new Project holds an `aokit.lock.json`: the Lockfile that records the Registry, the Release, each Module version and a hash for every generated file. Commit it with the rest ([Lockfile](../architecture/lockfile.md)).

## Run the dev server

```sh
cd my-app
bun run dev
```

The `dev` script comes from the framework Module you picked (for example `next` or `vite-react`). Read the `scripts` in the generated `package.json` for what your Modules added.

## Add a Module

`add` writes into an existing Project, so start from a clean working tree: commit your changes first, or pass `--allow-dirty`.

```sh
aokit add tailwind4
```

Preview it with `aokit add tailwind4 --dry-run`, or with `--diff` for unified diffs. The Resolver checks Capabilities before anything is written, so a Module that conflicts with one you already have fails with an explanation and changes nothing. Your own edits to generated files are merged, never overwritten.

To take a Module out again, run `aokit remove <module>`. To stop aokit from managing one file, run `aokit eject <path>`.

## Update

Check whether a newer Release or Module version exists:

```sh
aokit check
```

`check` writes nothing and exits `2` when an update is available, so CI can gate on it. To see what an update would change, then apply it:

```sh
aokit update --dry-run
aokit update
```

`update` renders the Project at the new Release and three-way merges it with your files. For a reviewed change in two steps, run `aokit update --plan`, read the saved Plan, then run `aokit update --apply`; `--apply` fails if the working tree changed in between. If the merge leaves conflicts, resolve the markers and `.aokit-new` copies by hand, or undo it with `aokit update --abort`. Without a terminal, `update` needs `--yes`.

`aokit diff` shows how your managed files differ from their Render, and `aokit diff --to <release>` compares against another Release without writing.

## Check the Project's health

```sh
aokit doctor
```

`doctor` is read-only. It reports Drift (files that no longer match the Lockfile), integrity problems, Resolver issues and dependencies, and prints the command that fixes each one. It exits `1` when it finds Drift. To restore one file to its Render, run `aokit restore <path>`.

## Next steps

- [Write your own Module](writing-modules.md).
- [Host a Registry](hosting-a-registry.md) that serves it.
- [Troubleshooting](../troubleshooting.md) for common errors.
- Let a coding agent drive aokit: `aokit mcp init --client claude` registers the MCP server (`cursor`, `vscode` and `codex` also work).
