# Voice

How aokit writes, on every surface: README, CLI, package pages, docs and the banner. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The strings themselves are in [copy.md](copy.md).

## Rules

1. Plain, category first. Say what it is, then what it does: "A Bun-only CLI that creates TypeScript projects" comes before any benefit.
2. One brand line, "Projects from Modules. Updates that merge." It appears on the cover and the banner. It is never the h1, and a fact always sits under it.
3. Glossary terms. Project, Module, Registry and Lockfile are capitalised as in the glossary. The tool is always lowercase `aokit`.
4. Commands in code. Every command and flag is in backticks, copied from the [CLI reference](../reference/cli.md).
5. Sentence case and active voice. Headings and buttons name a thing or start with a verb. No exclamation marks.
6. No claim without a source. Each public sentence maps to a command, an ADR or a file, recorded in "Claims checked" in [copy.md](copy.md).
7. English only. The README, the CLI and the package metadata stay in English.
8. No emojis in docs, README or CLI output. Commit messages keep their gitmoji, as the repository convention says.

## Glossary terms

| Write    | Not                                    |
| -------- | -------------------------------------- |
| Project  | app, workspace                         |
| Module   | plugin, preset, template, feature flag |
| Registry | store, marketplace                     |
| Lockfile | config, manifest                       |
| `aokit`  | Aokit, AOKit, AoKit                    |

The approved plain line keeps the lowercase word `projects`, because it is fixed verbatim in [copy.md](copy.md). Elsewhere a generated repository is a Project.

## Avoid list

Words and habits that do not appear in public copy:

- Hype: supercharge, blazing, magic, effortless, seamless, game-changing, revolutionary, powerful, robust, cutting-edge, next-generation.
- Filler: leverage, unlock, empower, elevate, streamline, delve, ecosystem as a vague noun.
- Metaphors and slogans that say nothing checkable.
- Em dashes used as asides. Use a comma, a colon or two sentences.
- Exclamation marks, rhetorical questions and "simply" or "just".
- Superlatives and comparisons with no source: fastest, best, only, first.
- Any promise about future versions outside the [roadmap](../roadmap.md).

## Examples

| Instead of                      | Write                                                        |
| ------------------------------- | ------------------------------------------------------------ |
| aokit supercharges your stack   | `aokit create` generates a TypeScript project from Modules   |
| Never worry about updates again | The Lockfile records a hash for every file, so updates merge |
| The best scaffolder for Bun     | A Bun-only CLI that creates TypeScript projects              |
