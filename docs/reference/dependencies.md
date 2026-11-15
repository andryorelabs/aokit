# Dependencies

The tools a machine needs to use aokit and to work on this repository, and the command that checks each one. Terms follow [GLOSSARY.md](../../GLOSSARY.md). Index: [docs](../README.md).

## Use the CLI

| Tool | Needed for                                                                                                                  | Check           | Required                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| Bun  | `bunx aokit`, the dependency install after `create`, `add`, `remove` and `update`. See [ADR-0006](../adr/0006-bun-only.md). | `bun --version` | Yes, 1.4.4 or newer, unless you run the standalone binary |
| Git  | The initial commit `create` makes, the clean-tree check and `git merge-file` for three-way merges.                          | `git --version` | Yes                                                       |

The [standalone binaries](../../README.md#install-the-binary) run the same CLI without Bun on `PATH`.

## Work on this repository

| Tool | Needed for                                                          | Check            |
| ---- | ------------------------------------------------------------------- | ---------------- |
| Bun  | Every script, at the version in `packageManager` of `package.json`. | `bun --version`  |
| Git  | Branches, hooks and the commit checks.                              | `git --version`  |
| `gh` | `repo-settings:check`, the release steps and pull requests.         | `gh auth status` |
| `jq` | The commands that apply repository settings.                        | `jq --version`   |
| npm  | Publishing, in the owner-only release steps.                        | `npm --version`  |

After the tools, run `bun install --frozen-lockfile` at the root, then `bun run check` to confirm the toolchain. See [Development](../development.md).
