# CLI UX

Rules for how the `aokit` CLI behaves in a terminal, in CI and under a coding agent. They follow [clig.dev](https://clig.dev) and use the vocabulary of [CONTEXT.md](../../CONTEXT.md). The CLI layer parses input and prints results only; generation logic lives in the [Engine](engine.md) (see the component map in the [overview](overview.md#component-map)). The single schema behind flags and prompts is described in [Interfaces](interfaces.md).

## Principles

1. **Everything promptable is also a flag.** Every prompt is generated from the same schema field as its flag ([Interfaces](interfaces.md#one-schema-many-surfaces)), so there is no question that cannot be answered non-interactively.
2. **Prompts are a convenience, never a requirement.** When stdin is not a TTY, or `--yes` is set, a missing required value is an error that names the flag, not a hang.
3. **Plan before apply.** Every command that changes a Project can show its [Plan](engine.md#vfs-and-plan-before-apply) first.
4. **Data on stdout, everything else on stderr.** Results and `--json` go to stdout; progress, prompts, spinners and hints go to stderr.
5. **Never leave a half-written Project.** See [Safe Ctrl+C](#safe-ctrlc).

## Flags common to all commands

| Flag | Meaning |
| --- | --- |
| `--yes`, `-y` | Accept defaults for every unanswered prompt; never prompt. |
| `--json` | Machine-readable result on stdout, nothing else on stdout. |
| `--dry-run` | Build the Plan, print it, write nothing. |
| `--diff` | Print the Plan as unified diffs per file (implies `--dry-run`). |
| `--no-color` | Disable color (same as `NO_COLOR`). |
| `--quiet`, `-q` | Only errors. |
| `--verbose`, `-v` | Print resolver decisions and per-Module timings to stderr. |
| `--help`, `-h` | Help with examples. |
| `--version`, `-V` | Print the CLI version only. |

### `create` flags

`create` adds `--layout <single|monorepo>`, `--modules a,b,c`, `--answer <module.key=value>` (repeatable), `--registry <name|source>` (a local directory, an `https://` URL or `github:owner/repo#ref`; the bundled first-party Registry is the default), `--trust <name|source>` (repeatable) and `--no-install`. `add` and `update` also take `--registry` and `--trust`. A target directory that exists and is not empty fails with exit code `3` and a `fix` that suggests another directory; an empty existing directory is used. The target check runs before `--dry-run` and `--diff`. `create --from <path|url>` replays a local or remote Lockfile.

### Lifecycle flags

Commands that write project files to an existing Project (`add`, `remove`, `recopy`, `restore`, later `update`) also accept `--allow-dirty` (skip the [clean-tree check](lifecycle.md#clean-tree-precondition)) and `--no-install` where a dependency install can follow. `add` takes `--answer` only for the Modules it adds; `remove` takes `--cascade` to remove the dependents in the same Plan. `doctor` has no `--fix`: it reports, and prints the command that fixes each problem.

## Non-interactive mode

`--yes` makes the run non-interactive: unanswered fields take their schema defaults, and fields with no default fail with exit code `3` and the name of the missing flag.

Non-interactive mode is also entered automatically, as if `--yes` were passed, when:

- stdin or stdout is not a TTY (`CI=true` is treated the same), or
- a coding agent is detected from its environment variables (the detection `trpc-cli` provides; the variable list is maintained in the command layer, not here).

Auto-detection prints one line to stderr (`non-interactive: coding agent detected, using defaults; pass --no-yes to prompt`) so the behavior is never silent. `--no-yes` forces prompts back on and fails if there is no TTY. Agents that need every answer to be explicit use the [MCP server](interfaces.md#mcp-server), where defaults are not applied.

## `--json`

With `--json`, stdout carries exactly one JSON document and nothing else, using the same envelope as the MCP tools:

```json
{ "ok": true, "data": { "plan": { "changes": [] } }, "error": null }
```

```json
{ "ok": false, "data": null, "error": { "code": "CAPABILITY_CONFLICT", "message": "...", "fix": "aokit remove prisma && aokit add drizzle" } }
```

An outcome that is not a success but still carries a report uses `ok: false` with a non-null `data` ([lifecycle outcomes](#lifecycle-outcomes)):

```json
{ "data": { "files": [] }, "error": { "code": "DRIFT", "message": "...", "fix": "aokit restore <path>" }, "ok": false }
```

- Keys are stable and sorted; the shape per command is the output schema exposed by [`aokit schema`](interfaces.md#aokit-schema).
- Progress, spinners and prompts are suppressed or sent to stderr. ANSI codes never appear in `--json` output.
- The process exit code still reflects the outcome, so scripts can use either.

## Exit codes

One table for every command. Codes are stable; new conditions get new numbers, never a reused one.

| Code | Name | When |
| --- | --- | --- |
| `0` | success | The command did what it was asked. For `check`: the Project is up to date. |
| `1` | failure | Unexpected runtime error, I/O error, network or integrity failure, a Registry that cannot be read, a failed apply that was rolled back, or an error raised inside the Engine. Also the `DRIFT` outcome of `doctor`. The Project is unchanged. |
| `2` | update available | **Only** `check`, as the `UPDATE_AVAILABLE` outcome: a newer Registry release or Module version exists. Used by CI as a gate. No other command exits `2`. |
| `3` | usage error | Unknown flag, invalid value, missing required value in non-interactive mode, schema validation failure, a path that is not in the Lockfile (`NOT_IN_LOCKFILE`), removing a Module that was not selected (`NOT_SELECTED`), an `http://` URL given as a Registry source. |
| `4` | resolution error | The Resolver rejected the selection (`requires` unmet, `conflicts`, [Cardinality](capabilities.md#cardinality) exceeded), or `remove` found remaining dependents (`DEPENDENTS_EXIST`). Nothing was built. |
| `5` | precondition failed | Dirty working tree for any command that writes project files (`add`, `remove`, `recopy`, `restore`, `update`), missing or unreadable Lockfile, `minCliVersion` newer than the CLI (`MIN_CLI_VERSION`). |
| `6` | merge conflicts | **Any** writing command (`add`, `remove`, `recopy`, `update`) completed the merge but left conflict markers or `.aokit-new` copies; the user must resolve them. A file kept with a warning (delete versus modify) is not a conflict. For `update`, resumable with `update --apply` or abandoned with `update --abort`. |
| `130` | interrupted | Ctrl+C or SIGTERM; the temporary directory was removed and the Project is unchanged. |

### Lifecycle outcomes

Some results are neither a plain success nor an unexpected failure: `doctor` found drift, `check` found an update, a merge left conflicts. They are **error codes that carry data**, not a separate channel. The envelope allows `ok: false` with a non-null `data` report, and the exit code is derived only from `error.code` ([ADR 0015](../adr/0015-lifecycle-outcomes-are-error-codes-with-data.md)).

| Code | Exit | Carries |
| --- | --- | --- |
| `DRIFT` | `1` | The `doctor` report. |
| `UPDATE_AVAILABLE` | `2` | `{ modules: [{ name, current, available, migration }] }`. |
| `MERGE_CONFLICTS` | `6` | The conflicted paths with provenance. |
| `DIRTY_TREE` | `5` | The dirty paths. |
| `MIN_CLI_VERSION` | `5` | The CLI version the Registry release needs. The Registry error `REGISTRY_CLI_TOO_OLD` maps here. |
| `LOCKFILE_MISSING` | `5` | None. |
| `NOT_IN_LOCKFILE`, `NOT_SELECTED` | `3` | None. |
| `DEPENDENTS_EXIST` | `4` | The dependents that block the removal. |
| `REGISTRY_UNTRUSTED` | `5` | The Registry and the exact `--trust` form. |
| `REGISTRY_FETCH_FAILED` | `1` | The Registry, the URL and the cause. |
| `REGISTRY_INTEGRITY_MISMATCH` | `1` | The Registry, the Module and both values. |
| `MODULE_VERSION_UNAVAILABLE` | `1` | Module, version and the `aokit recopy` fix (`aokit remove <module>` for `update`). |
| `MIGRATION_FAILED` | `1` | Module, script and the `from` to `to` jump. |
| `PLAN_STALE` | `5` | The files whose hash changed since `update --plan`. |
| `PLAN_MISSING` | `5` | None. |

A Resolver rejection keeps its raw Resolver code in `error.data.resolverCode`, so tools can branch on it without parsing the message. These codes are defined together, so adding a command never changes the code table.

### Reconciling with `@clack/prompts`

`@clack/prompts` has its own numeric codes, and they must not leak into ours:

- The clack spinner installs process handlers (SIGINT, SIGTERM, uncaught errors) and uses an internal code of `1` for "cancelled by signal" and `2` for "error" to choose which closing message to render. These are message selectors, not aokit exit codes.
- aokit's `check` exits `2` for "update available". The overlap is a coincidence of numbering, so the command layer never lets a spinner decide the process exit code.

Mapping rule: the command layer owns the exit code. A clack cancellation (spinner code `1`, a prompt's `isCancel`) becomes `130`; a clack error (spinner code `2`, a rejected promise inside a task) becomes `1`. Only `check` may produce `2`, and it does so after all spinners have closed. An implementation test asserts that `check` returns `2` with an update available and `1` when the network fails, so the two meanings cannot be confused. The exact behavior of the pinned clack version is verified when the CLI is implemented.

## `--dry-run` and `--diff`

Both stop after the Plan is built, exactly as in the [engine flow](engine.md#vfs-and-plan-before-apply); the Plan printed is the Plan that would be applied.

- `--dry-run` prints the change list (create, update, delete, rename) with per-Module provenance. With `--json` the list is the `plan` object.
- `--diff` prints unified diffs per file. For `update`, the diff shows old render to new render to the user's file.
- Both exit `0` when the Plan is valid, even if it is non-empty, and the usual error codes when it is not. `check` is the command for "is there anything to do".
- `update --plan` and `--apply` split the same two phases across invocations.

## Actionable errors

Every error answers three questions, in this order:

1. **What failed**: one sentence, with the names the user typed.
2. **Why**: the rule or fact that caused it (a Capability, a version, a path).
3. **Which command fixes it**: a command the user can copy, or the flag to add.

```text
error: cannot add `drizzle`
  why:  capability `orm` allows at most one provider (cardinality: max 1) and `prisma` already provides it
  fix:  aokit remove prisma && aokit add drizzle
        or keep prisma and drop drizzle from --modules
```

Resolver messages follow [Capabilities: error messages](capabilities.md#error-messages). Errors go to stderr (or into `error` with `--json`), carry a stable `code`, and never print a stack trace unless `--verbose`. Unexpected exceptions print the code `INTERNAL`, the path of a log file with the trace, and the issue URL.

## Safe Ctrl+C

The goal is that interrupting at any moment leaves either the old Project or the finished one, never a mixture.

- **Before apply** nothing is on disk: the Plan lives in the [VFS](engine.md#vfs-and-plan-before-apply), so cancelling during prompts, fetch, resolve or build has no side effects.
- **During apply** the [atomic write](engine.md#atomic-writes) applies: SIGINT removes the temporary directory and the Project is unchanged. The Lockfile is written last, so an interrupted run cannot leave a Lockfile that describes files that were not written.
- **Prompts**: a clack `group()` that is cancelled continues with the remaining prompts unless `onCancel` exits the process. aokit therefore always passes an `onCancel` that stops the run through the command layer (exit `130`) and never relies on the default. Standalone prompts check `isCancel` the same way.
- **Spinner**: the clack spinner owns SIGINT while it runs and renders its own cancel message. aokit does not install a competing handler during a spinner; cleanup (removing the temporary directory) is registered once through the command layer's shutdown hook, which runs alongside the spinner's handler, and the exit code comes from the mapping in [Exit codes](#reconciling-with-clackprompts).
- **Second Ctrl+C** during cleanup exits immediately with `130`; the temporary directory is a uniquely named sibling that `doctor` reports and removes if it survives.
- **Writing commands on an existing Project** copy every file they will overwrite or delete to a stash under `<git-dir>/aokit/stash/` first, and restore it if the commit fails part-way ([transactional apply](lifecycle.md#transactional-apply)).
- **`update`** that stops with conflicts is not "half written": it is the documented state exit code `6` describes, and `update --abort` restores the previous state.

## Color and TTY

- Color is off when `NO_COLOR` is set to any non-empty value, when `--no-color` is passed, when `TERM=dumb`, or when the stream is not a TTY. `FORCE_COLOR` turns it on and wins over TTY detection but not over `NO_COLOR`.
- Spinners, progress bars and cursor movement are used only on a TTY and never with `--json` or `--quiet`. Elsewhere, progress degrades to plain lines on stderr.
- Symbols have ASCII fallbacks for terminals without Unicode.
- Non-TTY output is not wrapped.

## Progress for long steps

Steps that can take more than about one second show progress on stderr: Registry fetch (per Module), integrity verification, Plan build, format phase, apply and dependency install. A spinner with a label for short steps; a determinate count (`fetching modules 3/7`) when the total is known. The dependency install runs after apply, [outside the deterministic phase](engine.md#determinism), and streams Bun's output only with `--verbose`. If the install fails, the Project is already applied and the error says which command to rerun (`bun install`).

## Shell completion

Completion is generated with `@bomb.sh/tab` from the same command definitions as the help text.

- `aokit completion <bash|zsh|fish|powershell>` prints the script; install instructions are in `--help` and the README.
- Module names, layouts and clients complete from the schema's enums; Module names also complete from the cached Registry index when present and never trigger a network call while completing.

## Help

`aokit --help`, `aokit <command> --help` and `aokit help <command>` print usage, flags grouped by the schema's `group` meta, and real examples taken from the schema's `examples` meta, so they cannot drift from the flags:

```text
Usage: aokit create [directory] [flags]

Examples:
  aokit create my-app --layout single --modules next,tailwind4,oxc --yes
  aokit create --from ./aokit.lock.json --dry-run
  aokit create my-app --yes --json | jq .data.plan.changes
```

Unknown commands suggest the closest match. `-h` never starts a prompt.

## Version and update notices

- `aokit --version` prints only the version (`0.1.0`), so it is script-safe. `--version --json` adds the Lockfile `lockfileVersion` and the Registry protocol version the CLI supports.
- **Update notices** tell the user a newer CLI exists. They are printed to stderr at most once per 24 hours, only on a TTY, never with `--json` or `--quiet`, in CI or in non-interactive mode, and never delay the command: the check reads a cached value and refreshes it in the background. `AOKIT_NO_UPDATE_NOTIFIER=1` disables them.
- The notice is about the CLI. Project updates are `aokit check` (exit `2`) and `aokit update`.
- There is no telemetry; see [Distribution](distribution.md#telemetry). The update check contacts only the npm registry for the `aokit` package and sends nothing beyond that request.

## Command summary

| Command | Interactive | Writes | Notable exit codes |
| --- | --- | --- | --- |
| `create` | yes | Project directory | `0`, `3`, `4`, `130` |
| `add` / `remove` | yes | Project files, Lockfile | `0`, `3`, `4`, `5`, `6`, `130` |
| `recopy` / `restore` | confirm only | Project files, Lockfile | `0`, `3`, `5`, `6`, `130` |
| `eject` | no | Lockfile | `0`, `3`, `5` |
| `update` | confirm only | Project files, Lockfile | `0`, `5`, `6`, `130` |
| `check` | no | nothing | `0`, `1`, `2` |
| `doctor` | no | nothing (read-only, no `--fix`) | `0`, `1`, `5` |
| `diff`, `schema`, `completion` | no | nothing | `0`, `3` |
| `mcp init` | yes | client config file | `0`, `3`, `130` |
