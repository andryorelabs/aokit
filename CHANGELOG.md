# Changelog

All notable changes to the `aokit` CLI, `create-aokit` and `@aokit/module` are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). For what a version number promises, see [stability](docs/stability.md).

The notes of each [GitHub Release](https://github.com/andryorelabs/aokit/releases) are the section of its tag in this file; a release fails when that section is missing or empty. Registry Releases use the dated `YYYY.MM.PATCH` scheme and are separate from the CLI versions below.

## [Unreleased]

### Changed

- Release notes come from this file instead of being generated from commit messages.

## [0.2.0] - 2026-11-11

### Added

- `aokit list` prints the Modules of the active Registry grouped by Capability, and the MCP server has a matching `list` tool.
- `aokit create` runs `git init` and makes an initial commit, and writes a README into the new Project. `--no-git` skips the git step.
- Every first-party Module has a description, shown by `aokit list`.
- `--quiet` and `-q` are accepted on every command, and `--help` lists `--json`, `--quiet` and `--verbose`.
- Community files: numbered issue forms (bug report, feature request, enhancement, documentation).

### Changed

- A Module manifest requires a `description` of 1 to 120 characters.
- `@aokit/module` no longer exports `sortKeysDeep`.
- Failures carry stable error codes and exit codes: an unknown Module fails with `MODULE_UNKNOWN` (exit `4`) and a did-you-mean suggestion, and git, Registry, patch and MCP client failures have their own codes.
- A Resolver error names every unmet requirement of a Module in one message, and its fix is a command you can run.
- Raw Resolver and Registry diagnostics print only with `--verbose`.
- `SUPPORT.md` moved to `.github/SUPPORT.md`.

### Fixed

- `aokit check` and `aokit doctor` pass on a Project that is not a git repository.
- `--help` no longer prints internal type words or empty defaults.
- Docs: the CLI reference, troubleshooting and getting-started guide match the CLI; the README leads with `bunx create-aokit` and shows the non-interactive form.
- Docs: Registry Release names are explained, and Migrations from a local Registry are documented as code that runs.

## [0.1.0] - 2026-11-10

The first release of the `aokit` CLI, `create-aokit` and `@aokit/module`.

### Added

- Create a TypeScript Project from composable Modules (`aokit create`), in a single or monorepo Layout, from the bundled first-party Registry or a local, `https://` or GitHub Registry.
- Keep it up to date: a Lockfile records a hash for every generated file, and `aokit update` three-way merges a new Registry Release with your edits. `check`, `diff`, `doctor`, `add`, `remove`, `eject`, `restore`, `recopy` and `layout migrate` cover the rest of the lifecycle.
- Resolver with Capabilities, a trust model for remote Registries, and `--json`, `--dry-run` and `--diff` on every command that writes.
- An MCP server (`aokit mcp`, `aokit mcp init`) for Claude, Cursor, VS Code and Codex, and a shadcn Registry adapter.
- Standalone binaries for Linux, macOS and Windows with checksums and build provenance attestations, and no telemetry.

[Unreleased]: https://github.com/andryorelabs/aokit/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/andryorelabs/aokit/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/andryorelabs/aokit/releases/tag/v0.1.0
