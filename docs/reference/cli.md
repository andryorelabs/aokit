# CLI reference

Every `aokit` command, its flags, the exit codes and the environment variables the CLI reads. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The rules behind these behaviors are in [CLI UX](../architecture/cli-ux.md); run `aokit <command> --help` for the same flags with examples, or `aokit schema <command>` for the JSON Schema of a command's input.

## Flags common to all commands

| Flag              | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| `--yes`, `-y`     | Accept defaults for every unanswered prompt; never prompt.      |
| `--json`          | Machine-readable result on stdout, nothing else on stdout.      |
| `--dry-run`       | Build the Plan, print it, write nothing.                        |
| `--diff`          | Print the Plan as unified diffs per file (implies `--dry-run`). |
| `--no-color`      | Disable color (same as `NO_COLOR`).                             |
| `--quiet`, `-q`   | Only errors.                                                    |
| `--verbose`, `-v` | Print resolver decisions and per-Module timings to stderr.      |
| `--help`, `-h`    | Help with examples.                                             |
| `--version`, `-V` | Print the CLI version only.                                     |

At the root, `aokit`, `aokit --help` and `aokit -h` print a short banner before the help when stdout is a terminal (plain text when color is off). The banner never appears when output is piped, with `--json`, for a subcommand's help or for `--version`.

`--dry-run` and `--diff` are only accepted by commands that write. Commands that write to an existing Project also take `--directory <path>` (default `.`), and, where a dependency install can follow, `--install` (on by default; `--no-install` skips it).

## Commands

### `create`

Create a new Project from a selection of Modules. Usage: `aokit create [directory]`. The directory must be missing or empty.

| Flag                                           | Meaning                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--layout <single\|monorepo>`                  | Project Layout; `single` by default.                                                              |
| `--modules <a,b,c>`                            | Comma-separated Modules to install.                                                               |
| `--from <path>`                                | Local `aokit.lock.json` to create from: its Layout, Module versions, answers and Registries.      |
| `--answer <module.key=value>`                  | Answer of a Module; repeatable. The only override allowed with `--from`.                          |
| `--registry <name\|source>`                    | A local directory, an `https://` URL or `github:owner/repo#ref`; the bundled Registry by default. |
| `--trust <name\|source>`                       | Trust a Registry; repeatable. `--yes` never grants trust.                                         |
| `--dry-run`, `--diff`, `--yes`, `--no-install` | As in the common flags.                                                                           |

### `add`

Add Modules to a Project. Usage: `aokit add <modules...>`.

| Flag                                                            | Meaning                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| `--directory <path>`                                            | Project directory (default `.`).                          |
| `--answer <module.key=value>`                                   | Answer of an added Module; repeatable.                    |
| `--registry <name\|source>`                                     | Registry to look the added Modules up in first.           |
| `--trust <name\|source>`                                        | Trust a Registry; repeatable. `--yes` never grants trust. |
| `--dry-run`, `--diff`, `--yes`, `--allow-dirty`, `--no-install` | As in the common flags and `--allow-dirty` below.         |

### `doctor`

Check the health of a Project: Drift states, integrity, Resolver and dependencies. Read-only; it has no `--fix` and prints the command that fixes each problem. Usage: `aokit doctor [directory]`. Exits `1` with the report when it finds Drift.

### `diff`

Show how managed files differ from their Render, or from a target Release. Usage: `aokit diff [directory]`.

| Flag             | Meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `--to <release>` | Release to render and compare the working tree against; writes nothing. |

### `check`

Check a Project for Release and Module updates. Usage: `aokit check [directory]`. Exits `2` (`UPDATE_AVAILABLE`) when a newer Release or Module version exists, so CI can gate on it. Writes nothing.

### `eject`

Eject a file from aokit management. Usage: `aokit eject <path>` with `--directory <path>`. The path is Project-relative and must be in the Lockfile.

### `remove`

Remove a Module from a Project by re-rendering without it and merging. Usage: `aokit remove <module>`.

| Flag                                                   | Meaning                                               |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `--directory <path>`                                   | Project directory (default `.`).                      |
| `--cascade`                                            | Also remove every Module that requires only this one. |
| `--yes`                                                | Also remove orphaned Modules without asking.          |
| `--dry-run`, `--diff`, `--allow-dirty`, `--no-install` | As in the common flags and `--allow-dirty` below.     |

### `recopy`

Re-render the Project at the Lockfile versions and merge it with an empty base. Usage: `aokit recopy`. Takes `--directory`, `--dry-run`, `--diff`, `--yes`, `--allow-dirty` and `--no-install`.

### `update`

Update a Project to a newer Release. Usage: `aokit update`.

| Flag                                                   | Meaning                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `--directory <path>`                                   | Project directory (default `.`).                                               |
| `--to <release>`                                       | Release to update to; the latest one the Registry lists by default.            |
| `--registry <name\|source>`                            | Lockfile Registry name or source; `github:owner/repo#<ref>` moves that Pin.    |
| `--trust <name\|source>`                               | Trust a Registry; repeatable. `--yes` never grants trust.                      |
| `--plan`                                               | Write a reviewable Plan to the update state directory and change nothing else. |
| `--apply`                                              | Apply exactly the Plan `--plan` saved; fails when the tree changed since.      |
| `--abort`                                              | Undo a conflicted update and delete a saved Plan.                              |
| `--yes`                                                | Apply without asking; required without a terminal.                             |
| `--dry-run`, `--diff`, `--allow-dirty`, `--no-install` | As in the common flags and `--allow-dirty` below.                              |

### `restore`

Restore a file to its Render at the Lockfile versions. Usage: `aokit restore <path>`. Takes `--directory`, `--dry-run`, `--diff`, `--yes` and `--allow-dirty`.

### `schema`

Print the JSON Schema of a command's input. Usage: `aokit schema [command]`; without a command it prints an index of commands. `--output` also prints the command's output schema.

### `layout migrate`

Migrate a Project to another Layout, keeping the user's edits. Usage: `aokit layout migrate [layout]`. Takes `--directory`, `--dry-run`, `--diff`, `--yes` and `--allow-dirty`. `--abort` undoes a conflicted migration.

### `mcp init`

Register the aokit MCP server (`bunx aokit mcp`) in a client config. Usage: `aokit mcp init --client <claude|cursor|vscode|codex>`.

| Flag                 | Meaning                                                       |
| -------------------- | ------------------------------------------------------------- |
| `--client <name>`    | MCP client to register the server in.                         |
| `--directory <path>` | Project directory that holds the client config (default `.`). |
| `--print`            | Print the setup instructions instead of writing (`claude`).   |
| `--dry-run`          | Print the change and write nothing.                           |

`--allow-dirty` skips the [clean-tree check](../architecture/lifecycle.md#clean-tree-precondition) that every command writing project files makes.

## Exit codes

One table for every command. Codes are stable; new conditions get new numbers, never a reused one.

| Code  | Name                | When                                                                                                                            |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `0`   | success             | The command did what it was asked. For `check`: the Project is up to date.                                                      |
| `1`   | failure             | Unexpected runtime, I/O, network or integrity failure, or Drift found by `doctor`. The Project is unchanged.                    |
| `2`   | update available    | `check` found a newer Release or Module version (`UPDATE_AVAILABLE`), or a Registry environment variable is unset.              |
| `3`   | usage error         | Unknown flag or command, invalid or missing value, invalid config, a path not in the Lockfile, a Module that was not selected.  |
| `4`   | resolution error    | The Resolver rejected the selection, or `remove` found remaining dependents.                                                    |
| `5`   | precondition failed | Dirty working tree, missing Lockfile, `minCliVersion` newer than the CLI, an untrusted Registry, a missing or stale saved Plan. |
| `6`   | merge conflicts     | A writing command left conflict markers or `.aokit-new` copies for the user to resolve.                                         |
| `130` | interrupted         | Ctrl+C or SIGTERM; the temporary directory was removed and the Project is unchanged.                                            |

### Error codes

Every error code maps to exactly one exit code. The envelope printed with `--json` carries the code in `error.code`.

| Code                          | Exit  | Meaning                                                                |
| ----------------------------- | ----- | ---------------------------------------------------------------------- |
| `INVALID_INPUT`               | `3`   | A value failed schema validation.                                      |
| `MISSING_VALUE`               | `3`   | A required value is missing in non-interactive mode.                   |
| `UNKNOWN_FLAG`                | `3`   | The flag does not exist.                                               |
| `UNKNOWN_COMMAND`             | `3`   | The command does not exist.                                            |
| `INVALID_CONFIG`              | `3`   | The user config or Lockfile cannot be parsed.                          |
| `NOT_IN_LOCKFILE`             | `3`   | The path is not managed by aokit.                                      |
| `NOT_SELECTED`                | `3`   | The Module is not selected in the Project.                             |
| `CAPABILITY_CONFLICT`         | `4`   | Two selected Modules conflict on a Capability.                         |
| `REQUIREMENT_UNMET`           | `4`   | A Module requires a Capability nothing provides.                       |
| `CARDINALITY_EXCEEDED`        | `4`   | More Modules provide a Capability than its cardinality allows.         |
| `DEPENDENTS_EXIST`            | `4`   | Other Modules still require the Module being removed.                  |
| `DIRTY_TREE`                  | `5`   | The working tree has uncommitted changes.                              |
| `LOCKFILE_MISSING`            | `5`   | The directory is not an aokit Project.                                 |
| `PLAN_REQUIRED`               | `5`   | The command needs a saved Plan first.                                  |
| `PLAN_STALE`                  | `5`   | Files changed since `update --plan`.                                   |
| `PLAN_MISSING`                | `5`   | `update --apply` found no saved Plan.                                  |
| `MIN_CLI_VERSION`             | `5`   | The Registry release needs a newer CLI.                                |
| `REGISTRY_UNTRUSTED`          | `5`   | The Registry is not trusted; the error shows the exact `--trust` form. |
| `MERGE_CONFLICTS`             | `6`   | The merge left conflicts to resolve.                                   |
| `INTERRUPTED`                 | `130` | The run was interrupted.                                               |
| `UPDATE_AVAILABLE`            | `2`   | `check` found updates.                                                 |
| `REGISTRY_ENV_UNSET`          | `2`   | A Registry URL references an environment variable that is not set.     |
| `DRIFT`                       | `1`   | `doctor` found Drift.                                                  |
| `MODULE_VERSION_UNAVAILABLE`  | `1`   | The Lockfile version of a Module is no longer served.                  |
| `IO_ERROR`                    | `1`   | A file operation failed.                                               |
| `INTERNAL`                    | `1`   | Unexpected error; the Project is unchanged.                            |
| `MIGRATION_FAILED`            | `1`   | A Module migration script failed.                                      |
| `REGISTRY_FETCH_FAILED`       | `1`   | The Registry could not be fetched.                                     |
| `REGISTRY_INTEGRITY_MISMATCH` | `1`   | A fetched artifact does not match its recorded integrity hash.         |
| `REGISTRY_ITEM_UNSUPPORTED`   | `1`   | A shadcn item has a type aokit cannot adapt.                           |
| `REGISTRY_ITEM_CHANGED`       | `1`   | A shadcn item changed since it was recorded.                           |

A code outside this table is treated as an unexpected failure (`1`).

## Environment variables

| Variable                          | Meaning                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AOKIT_NO_UPDATE_NOTIFIER`        | Set to `1` to disable the once-a-day update notice on stderr.                                                                                          |
| `AOKIT_AGENT`                     | Any value marks the run as made by a coding agent: non-interactive mode, as with `CI`, `CLAUDECODE`, `CURSOR_AGENT`, `CODEX_SANDBOX` and `GEMINI_CLI`. |
| `AOKIT_BUNDLED_REGISTRY_RELATIVE` | Build-time constant that locates the bundled Registry next to the packaged CLI. Set by the build, not by users.                                        |

The CLI also honors `NO_COLOR`, `CI`, `XDG_CONFIG_HOME` (user config at `$XDG_CONFIG_HOME/aokit/config.json`) and `XDG_CACHE_HOME` (Registry cache).
