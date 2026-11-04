# 0019. MCP tools take an explicit variant of the command schema and session-scoped plan ids

Status: Accepted (2026-11-04)
Spec: S1 to S12 (phase 6a spec)
Architecture: [Interfaces: MCP server](../architecture/interfaces.md#mcp-server)

## Context

An agent that drives aokit through MCP cannot answer a prompt, cannot be trusted to read defaults it never saw, and can write a Project it never showed the user. The CLI already has one Zod schema per command with defaults, prompts and CLI-only flags such as `--dry-run`, `--yes` and `--install`. The MCP server must reuse that schema without a second hand-written copy, and it must make "plan, then write" a rule the server enforces instead of a convention the agent follows.

## Decision

The MCP tools are thin callers of the command layer, with two additions.

- **Explicit input**: each tool's input is derived mechanically from the command's Zod input by `toExplicitInput`. Defaults are removed, every optional field becomes required and nullable, and the CLI-only fields `dryRun`, `diff`, `yes`, `install` and `allowDirty` are dropped. `install` and `allowDirty` are always false in MCP, so the server never runs `bun install` and never writes into a dirty tree. `trust` and `registry` stay as explicit fields. A test compares the derived schema with the CLI schema and fails when a field is in neither the MCP schema nor the CLI-only list.
- **Session plan ids**: `plan` and `plan_add` return a `planId`, the hash of the normalized input, the resolved Release and the Plan's VFS hash. The server keeps the ids it issued in memory for the life of the session. `create` and `add` re-plan the same input before writing and fail with `PLAN_REQUIRED`, writing nothing, when the id was not issued in this session or no longer matches.
- **Absolute directory**: `directory` must be an absolute path, because the server's working directory is not something an agent can know.
- **No interaction**: commands receive `interactive: false`, so no prompt or readline is ever opened. An untrusted Registry fails with an error whose fix names the `trust` field.
- **Stdout**: `aokit mcp` is routed before the CLI renderer, so stdout carries only protocol frames.

## Consequences

- One schema stays the contract for flags, `--json`, `aokit schema` and MCP; a new command field reaches MCP as a required field without extra work.
- An agent cannot write a Project it did not plan in the same session, and cannot reuse a plan after the Project, the Lockfile or the Release changed.
- A new server process starts with no plan ids, so a plan never survives a restart.
- A command field that is a CLI-only concern must be added to the CLI-only list, or the drift test fails.
- Agents state every choice, so the printed `reproduce` command and the Lockfile fully describe what ran.

## Alternatives considered

- **Hand-written MCP input schemas**: rejected. They drift from the CLI schema, which ADR 0009 exists to prevent.
- **Plan ids persisted on disk**: rejected. It adds a store with cleanup and trust concerns, and the re-plan before writing already catches staleness.
- **Stateless plan ids with no session record**: rejected. A hash an agent can compute itself would not prove that the Plan was reviewed.
- **Applying defaults silently in MCP**: rejected. The agent could not reproduce its own action from the printed command.
- **Writing codex config in v1**: deferred. It needs a TOML patcher that nothing else uses yet.
