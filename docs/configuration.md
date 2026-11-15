# Configuration

Every environment variable the aokit code reads. aokit has no config-file switches for these; the user config at `$XDG_CONFIG_HOME/aokit/config.json` is a separate file described in the [CLI reference](reference/cli.md). Terms follow [GLOSSARY.md](../GLOSSARY.md). Index: [docs](README.md).

A test (`tools/docs/configuration-doc.test.ts`) scans `packages/*/src` and fails when a variable it reads is missing from the tables below.

## aokit variables

| Variable                          | Read by                  | Meaning                                                                                                                 |
| --------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `AOKIT_AGENT`                     | trust gate               | Any non-empty value marks the run as made by a coding agent: non-interactive mode, as the agent variables below do.     |
| `AOKIT_NO_UPDATE_NOTIFIER`        | update notice            | Set to `1` to disable the once-a-day update notice on stderr. `create-aokit` sets it for the `aokit` process it starts. |
| `AOKIT_BUNDLED_REGISTRY_RELATIVE` | bundled Registry locator | Build-time constant that locates the bundled Registry next to the packaged CLI. Set by the build, never by users.       |

## Agent and CI detection

The trust gate treats the run as non-interactive when any of these is set to a non-empty value, so a Registry trust prompt never blocks an agent or a pipeline.

| Variable        | Meaning                                             |
| --------------- | --------------------------------------------------- |
| `CI`            | Set by CI systems. Also disables the update notice. |
| `CLAUDECODE`    | Set by Claude Code.                                 |
| `CURSOR_AGENT`  | Set by the Cursor agent.                            |
| `CODEX_SANDBOX` | Set by the Codex sandbox.                           |
| `GEMINI_CLI`    | Set by the Gemini CLI.                              |

## Colour

| Variable      | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `NO_COLOR`    | Any non-empty value disables colour, as `--no-color` does. It wins over `FORCE_COLOR`. |
| `FORCE_COLOR` | Any non-empty value other than `0` enables colour even when stdout is not a terminal.  |
| `TERM`        | `dumb` disables colour.                                                                |

## Directories

| Variable          | Meaning                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `XDG_CONFIG_HOME` | Base of the user config: `$XDG_CONFIG_HOME/aokit/config.json`. Must be absolute; otherwise `~/.config`.      |
| `XDG_CACHE_HOME`  | Base of the Registry cache and kept index: `$XDG_CACHE_HOME/aokit/`. Must be absolute; otherwise `~/.cache`. |
| `APPDATA`         | Windows base of the user config, used instead of `XDG_CONFIG_HOME` fallbacks.                                |
| `LOCALAPPDATA`    | Windows base of the cache, used instead of `XDG_CACHE_HOME` fallbacks.                                       |
| `HOME`            | Home directory for the fallbacks above.                                                                      |
| `USERPROFILE`     | Windows home directory, read before `HOME`.                                                                  |

## Internal

| Variable                      | Meaning                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `NAPI_RS_NATIVE_LIBRARY_PATH` | Set and removed by the standalone binary while it loads its embedded native libraries. Never set it by hand. |
