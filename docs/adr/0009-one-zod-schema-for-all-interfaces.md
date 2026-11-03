# 0009. One Zod schema drives CLI, prompts and MCP, with trpc-cli behind an own command layer

Status: Accepted (2026-11-03)
Spec: S10, S9 (AO-2673)
Architecture: [Interfaces](../architecture/interfaces.md), [CLI UX](../architecture/cli-ux.md)

## Context

aokit has several entrances: flags, interactive prompts, `--json`, an MCP server for agents and possibly a web UI. Declaring a field separately for each lets them drift, and the rule "everything promptable is also a flag" requires one source.

## Decision

Each command input is one Zod v4 schema, with presentation details in a typed meta registry (`flag`, `alias`, `positional`, `prompt`, `group`, `hidden`, `examples`). Inputs must be JSON-Schema-representable (`z.toJSONSchema(schema, { io: "input" })`). The same schema drives flags (trpc-cli), clack prompts, `--json`, `aokit schema` and MCP tool input schemas. trpc-cli is never called from command code: an own command layer defines commands as `{ name, input, output, run(ctx, input) }` and one adapter binds them to trpc-cli. Results use `{ok, data, error}` everywhere.

## Consequences

- A field is declared once; surfaces cannot disagree.
- trpc-cli is replaceable by rewriting one adapter; commands, tests and the MCP server call `run` directly.
- Cross-field rules live in the Resolver, not schema refinements, to keep schemas representable.
- The own command layer is code to maintain.

## Alternatives considered

- **citty**: rejected because the [research](../research/cli-and-tooling.md) found no shell completion and weak help output.
- **gunshi**: rejected because it was a release candidate at research time.
- **Using trpc-cli directly in commands**: rejected because it couples tests and MCP to the parser.
- **Separate definitions per surface**: rejected because they drift.
