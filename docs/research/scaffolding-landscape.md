# Scaffolding landscape

Findings only. What aokit does about them lives in `docs/architecture/` (not yet written; links will be added there once it exists).

Source convention: `raw-notes.md` means [raw-notes.md](raw-notes.md), the unedited research from the planning session. Line numbers refer to that file. The notes record that local clones of both tools were read during the research (raw-notes.md L103); the clones are not in this repo, so the upstream repositories are cited as the places to verify.

## create-t3-app

Upstream: <https://github.com/t3-oss/create-t3-app>

How it works (as read from a local clone, raw-notes.md L7, L103):

- A base template holds the files every generated project gets.
- Per-package installers (one per selectable option) copy prewritten variant files over or beside the base files and edit `package.json`.
- Each option's logic therefore lives in a dedicated installer plus a set of variant files, not in a declarative manifest.

Where it breaks down for growth:

- Combinations are handled by choosing between prewritten variant files, so supporting a new option that interacts with existing ones means touching existing installers and variants (the problem statement recorded in the spec, [AO-2673](https://linear.app/andryore/issue/AO-2673/spec-aokit-research-architecture-and-standards-docs)).
- After generation the tool leaves the project alone; there is no later `add` or `update` (raw-notes.md L7: "adding modules later must never require restructuring" is the stated goal that the reference does not meet).

Confidence: the structural description comes from reading source in a local clone; it has not been re-verified against upstream HEAD for this document.

## Better-T-Stack

Upstream: <https://github.com/AmanVarshney01/create-better-t-stack> (verify the exact repository path before citing it elsewhere; the notes name the tool as `Better-T-Stack` only).

Pipeline (raw-notes.md L7, L26, L30):

1. Compatibility rules decide which option combinations are legal.
2. Layered Handlebars templates generate files.
3. Output goes to a virtual file system.
4. Dependency and environment processors adjust `package.json` and env files.

Other properties recorded in the notes:

- `bts.jsonc` is written into the generated project. It enables the `add` command and lets the tool print a reproducible command (raw-notes.md L7, spec S1).
- It ships an MCP server with tools `get_guidance`, `get_schema`, `plan`, `create` (marked `destructiveHint`), `plan_addons`, `add_addons`. Every result has the shape `{ok, data, error}`, and the flow is "plan before create" (raw-notes.md L30). See [cli-and-tooling.md](cli-and-tooling.md#mcp).
- Its CLI stack, per the notes: trpc-cli, oRPC, Zod 4, `@clack/prompts` ^1.8, `@modelcontextprotocol/server` 2.3.1, ts-morph, tsdown, Node >= 22 (raw-notes.md L26).
- Tests run an in-memory matrix of option combinations (spec S1; raw-notes.md L7).

Where it breaks down for growth (as stated in the spec problem statement, AO-2673):

- Option logic is spread across `{{#if}}` conditionals in templates and compatibility rules written per combination, so adding an option means editing shared templates and rules.
- `bts.jsonc` records choices, but updating a generated project to a newer tool version is not a recorded capability in the notes; the notes frame `add` as the post-creation feature. Unverified whether upstream offers an update path.

Confidence: pipeline order and `bts.jsonc` come from the research notes (clone read); version numbers are as of 2026-11-01.

## Related comparison points

- Lifecycle tools (Copier, cruft, Projen, `nx migrate`, `ng update`) cover the post-generation story that neither tool above covers: [lifecycle-and-versions.md](lifecycle-and-versions.md).
- Edit engines and registry formats: [engine-and-registry.md](engine-and-registry.md).
