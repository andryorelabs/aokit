# CLI and tooling findings

Findings only. Decisions are in [`docs/architecture/`](../architecture/overview.md). `raw-notes.md` = [raw-notes.md](raw-notes.md); line numbers refer to it. Research date 2026-11-01 (context7 + web).

## Command frameworks and completion (raw-notes.md L26)

| Tool | Finding | Link |
| --- | --- | --- |
| trpc-cli | Turns a schema into flags, prompts, `--json` and completion; has agent detection (v0). Better-T-Stack uses it | <https://github.com/mmkal/trpc-cli> |
| citty | No shell completion, weak help output | <https://github.com/unjs/citty> |
| gunshi | Release candidate at research time | <https://github.com/kazupon/gunshi> |
| stricli | Listed as evaluated; no finding recorded (unverified) | <https://github.com/bloomberg/stricli> |
| `@bomb.sh/tab` | Shell completion library | <https://github.com/bombshell-dev/tab> |

## `@clack/prompts` v1 caveats (raw-notes.md L27)

Source: <https://github.com/bombshell-dev/clack>.

- `group()` cancel: when a prompt in a group is cancelled, the remaining prompts continue unless an `onCancel` handler exits.
- The spinner owns SIGINT and exit codes, so a project's exit-code table has to be reconciled with it.

## Zod v4 (raw-notes.md L28)

Source: <https://zod.dev/json-schema>, <https://zod.dev/metadata>.

- `z.toJSONSchema(schema, { io: "input" })` produces JSON Schema.
- A custom typed registry (`z.registry<Meta>()`) can hold per-field metadata such as flag and prompt information.
- Only JSON-Schema-representable types can be public inputs.
- For MCP use: all fields explicit, nothing written to stdout.

## Bun `--compile`

Source: raw-notes.md L29; <https://bun.sh/docs/bundler/executables>.

- Set `autoloadDotenv` and `autoloadBunfig` to false, otherwise the binary loads `.env` / `bunfig.toml` from the current directory.
- Dynamic imports that cannot be resolved at build time are not embedded; sources must be static imports or bundled as assets.
- Native oxc bindings are best avoided inside the binary.
- Separately, an npm build running on Node is feasible if Bun-specific APIs are isolated behind an adapter (raw-notes.md L29, L54).

## MCP

Source: raw-notes.md L30; <https://modelcontextprotocol.io>, <https://github.com/modelcontextprotocol/typescript-sdk>.

- The SDK v2 registers tools with `registerTool` and accepts Standard Schema inputs.
- Better-T-Stack tool pattern: `get_guidance`, `get_schema`, `plan`, `create` with `destructiveHint`, `plan_addons`, `add_addons`; results `{ok, data, error}`; plan before create.
- A client setup command (`mcp init --client`) is proposed by the research.
- shadcn also ships an MCP server (listed in spec S1 as a pattern to review); no details were captured in the raw notes, so none are stated here.

## Agent files (raw-notes.md L31)

- `AGENTS.md` at the root with `CLAUDE.md` importing or symlinking it: <https://agents.md>
- Skills at `.claude/skills/<name>/SKILL.md`, following <https://agentskills.io>.
- The reference repos already use `CLAUDE.md` containing `@AGENTS.md`: [reference-repos-audit.md](reference-repos-audit.md).

## Release and supply chain (raw-notes.md L32)

- npm trusted publishing via OIDC with provenance: <https://docs.npmjs.com/trusted-publishers>
- Binaries with `SHA256SUMS` and attestations: <https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations>
- Release tooling options named in the spec: changesets (<https://github.com/changesets/changesets>), or bumpp + changelogithub.

## Telemetry practice (raw-notes.md L32)

The research finds no telemetry is the baseline, with opt-in possible later honoring `DO_NOT_TRACK` (<https://consoledonottrack.com>). No survey of other CLIs' telemetry was captured in the notes.

## CLI UX reference (raw-notes.md L49)

The notes cite clig.dev as the principle set for flags, exit codes, errors, safe Ctrl+C, `NO_COLOR` and completion: <https://clig.dev>.
