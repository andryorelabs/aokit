# Changelog

Release notes for each version are also on [GitHub Releases](https://github.com/andryorelabs/aokit/releases). For what a version number promises, see [stability](docs/stability.md). Registry Releases use the dated `YYYY.MM.PATCH` scheme and are separate from the CLI versions below.

## Unreleased

### Fixed

- `aokit create` runs `git init` and makes an initial commit, and writes a README into the new Project. `--no-git` skips the git step.
- `aokit list` prints the Modules of the active Registry grouped by Capability.
- Typed errors: an unknown Module fails with `MODULE_UNKNOWN` (exit `4`), and failures carry stable error codes and exit codes.
- Docs: the CLI reference, troubleshooting and getting-started guide match the CLI; the README leads with `bunx create-aokit`, shows the non-interactive form and has CI, Release, License and OpenSSF Scorecard badges.
- Docs: Registry Release names are explained, and Migrations from a local Registry are documented as code that runs.
- Community files: numbered issue forms (bug report, feature request, enhancement, documentation), and `SUPPORT.md` moved to `.github/SUPPORT.md`.

## 0.1.0

The first release of the `aokit` CLI, `create-aokit` and `@aokit/module`.

- Create a TypeScript Project from composable Modules (`aokit create`), in a single or monorepo Layout, from the bundled first-party Registry or a local, `https://` or GitHub Registry.
- Keep it up to date: a Lockfile records a hash for every generated file, and `aokit update` three-way merges a new Registry Release with your edits. `check`, `diff`, `doctor`, `add`, `remove`, `eject`, `restore`, `recopy` and `layout migrate` cover the rest of the lifecycle.
- Resolver with Capabilities, a trust model for remote Registries, and `--json`, `--dry-run` and `--diff` on every command that writes.
- An MCP server (`aokit mcp`, `aokit mcp init`) for Claude, Cursor, VS Code and Codex, and a shadcn Registry adapter.
- Standalone binaries for Linux, macOS and Windows with checksums and build provenance attestations, and no telemetry.
