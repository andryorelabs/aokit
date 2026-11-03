# Lifecycle

`create` is the first command of a Project's life, not the last. This page specifies the commands that keep a Project maintainable: what each one reads, builds and writes. All of them are built from the same parts: the [Resolver](capabilities.md#resolution-order), the [Engine](engine.md) (VFS, Plan, atomic apply) and the [Lockfile](lockfile.md). Vocabulary follows [CONTEXT.md](../../CONTEXT.md). Related: [overview](overview.md), [Module contract](module-contract.md), [Layouts](layouts.md), [versions](versions.md).

## Command reference

| Command | Purpose | Writes |
| --- | --- | --- |
| `create [dir]` | Build a new Project from a selection. | Whole Project and Lockfile. |
| `create --from <lockfile\|url>` | Same, replaying another Project's Lockfile. | Whole Project and Lockfile. |
| `add <module>` | Add a Module, plus any Modules it requires. | Plan changes, Lockfile. |
| `remove <module>` | Remove a Module. | Plan changes, Lockfile. |
| `update` | Move Modules to newer versions. | Plan changes, Lockfile. |
| `update --plan` / `--apply` / `--abort` | Two-phase update. | Plan file / Plan changes / nothing. |
| `doctor` | Report drift and Lockfile health. | Nothing. |
| `eject <path>` | Hand a file to the user for good. | Lockfile. |
| `restore <path>` | Bring a file back to the rendered state. | One file, Lockfile. |
| `diff` | Show how the working tree differs from a fresh render. | Nothing. |
| `check` | Say whether an update is available (CI). | Nothing. |
| `recopy` | Re-render everything from the current versions, ignoring history. | Plan changes, Lockfile. |

Every command that builds a Plan accepts `--dry-run` and `--diff` ([Engine](engine.md#vfs-and-plan-before-apply)). Flags, `--json`, `--yes` and the full exit-code table belong to the CLI UX design; this page names only the exit codes that carry lifecycle meaning.

### Clean-tree precondition

Commands that write (`add`, `remove`, `update`, `recopy`, `restore`, `layout migrate`) require a clean working tree when the Project is inside a git repository: no uncommitted changes to any file the Plan would touch. If the tree is dirty the command stops before building anything and says which files are dirty. The point is that the user's own work is always recoverable with git and that a conflict in the merge can only come from committed edits. `--allow-dirty` skips the check explicitly; there is no implicit skip. Outside a git repository, the check is replaced by comparing against the Lockfile hashes and a warning that no undo exists. Read-only commands do not need a clean tree.

## `create`

1. **Collect.** Layout, Modules and answers from flags, prompts or `--from`.
2. **Fetch, resolve, build.** As in the [overview flow](overview.md#the-create-and-add-flow): fetch with integrity, resolve Capabilities, build in an empty VFS, run the pinned format phase.
3. **Plan.** `--dry-run` / `--diff` stop here.
4. **Apply.** Atomic write; the Lockfile is written last.
5. **Install.** `bun install` runs after apply, outside the deterministic phase. `--no-install` skips it. An install failure leaves the applied Project in place, exits `1` and tells the user to rerun `bun install`.
6. **Print the reproducible command** (below).

### `create --from <lockfile|url>`

Replaces step 1 with the contents of an existing Lockfile: a local path, or a URL (including a raw file in a git repository). Layout, Module versions, answers and Registries are taken from it; Registry sources and integrity are re-verified. The user's Project becomes a replay of the source one and gets its own fresh Lockfile. There is no preset mechanism: reusable selections are the Lockfile of a real Project. Flags given alongside `--from` override single answers, not Module versions.

### Reproducible command

After `create` and `add`, the CLI prints one command line that reproduces the selection non-interactively, with every answer as an explicit flag:

```text
bunx create-aokit my-app --layout monorepo --modules next,oxc --answer next.appRouter=true --yes
```

It is derived from the Lockfile, so it is the same for any CLI version that wrote the same state, and it is also what `--json` returns in a `reproduce` field.

## `add <module>`

1. Require a clean tree.
2. Load the Lockfile; fetch the new Module (and any auto-accepted providers of its `requires`) with integrity.
3. Resolve over the **existing Modules plus the new one**, so Cardinality, `conflicts` and Extension point ranges are checked against the whole Project ([Capabilities](capabilities.md#deriving-compatibility)).
4. Enter the [merge procedure](#the-merge-procedure) with the new Module in the target selection.
5. Show the Plan; apply; update the Lockfile.

Because the Module reaches others only through Capabilities and Extension points, nothing here edits another Module's files except through Ops at declared Extension points, which are the shared files' normal `owners` ([Lockfile](lockfile.md#field-table)).

## `update`

`update` is Copier-style: it renders what aokit would have produced, compares that with what the user has, and merges.

1. **Clean tree**, then read the Lockfile and fetch the **target** Module versions from the Registry (the latest release, or `--to <release>`). Check `minCliVersion`.
2. **Render the old state** in a VFS: the Modules at the versions and answers recorded in the Lockfile, same Layout, same pinned format phase. This is the *base*. Old versions are fetchable by design ([Lockfile](lockfile.md#old-module-versions-stay-fetchable)).
3. **Diff old to user.** For each file, compare the base with the working tree. The recorded `hash` makes this cheap: a `pristine` file equals its base without rendering it, so the render is only needed for `modified` files ([hashes](lockfile.md#per-file-hashes)).
4. **Run `before` migrations** for each Module whose version crosses a migration range ([Migrations](#migrations)). They run on the *user's* VFS and can rewrite answers, so the new render uses the migrated answers.
5. **Render the new state** in a VFS: target versions, migrated answers. This is *theirs*.
6. **Merge** base, user and new through the [merge procedure](#the-merge-procedure).
7. **Run `after` migrations** on the merged VFS.
8. **Plan.** `--dry-run`, `--diff` or `--plan` stop here.
9. **Apply.** Atomic write; the Lockfile is rewritten with new versions, `integrity`, hashes and `deps`.
10. **Install.** `bun install` if `package.json` changed; the Bun lockfile is regenerated, never merged.

**Respect deliberate deletions.** A file that is in the Lockfile but absent on disk (state `deleted`) was removed by the user. If the new render still contains it, `update` does not recreate it. If the new render modified it, that is the delete-vs-modify case: the file stays deleted, and a warning is printed ([merge policy](lockfile.md#merge-policy)). `restore <path>` brings it back.

### Conflicts

When the `Merger` cannot reconcile a file, `update` leaves the conflict **in the working tree**:

- The file contains conflict markers (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`) with the base, user and new versions labeled.
- In a git repository, the index gets the three **stages** for the path (1 base, 2 user, 3 new), so `git status` shows the file as unmerged and `git mergetool` works. Resolving it and running `git add` is the user's way to finish; aokit never stages anything on its own.
- Binary conflicts leave the user's file and write `<name>.aokit-new` beside it.
- The Lockfile is written for the non-conflicted state; conflicted files keep their previous `hash`, so `doctor` reports them as `modified` until resolved, and `update` can be re-run.
- The exit code is non-zero and the output lists the conflicted paths with their provenance (which Module and version).

### `update --plan`, `--apply`, `--abort`

Two-phase update for CI and review.

- `update --plan` runs steps 1 to 8 and writes the Plan, including the merged content and the conflict list, to `.git/aokit/plan.json` (outside the working tree). It changes nothing in the Project. The Plan records the hashes of every file it read.
- `update --apply` applies that Plan. If any recorded hash or the Lockfile has changed since the plan, it refuses and asks for a new `--plan`: what the user reviewed is what is written ([Engine](engine.md#vfs-and-plan-before-apply)).
- `update --abort` discards a saved Plan, and after a conflicted `update` or `--apply` restores the working tree and index to the pre-update state from the stash of originals kept under `.git/aokit/`.

### `check`

Read-only. Fetches the Registry index and compares the Lockfile's Module versions and Registry release with what is available.

- Exit 0: up to date.
- Exit **2**: an update is available. Meant for a scheduled CI job that opens an issue or a branch.
- Other non-zero codes follow the general exit-code table.

`check --json` lists Modules with current and available versions and whether a migration is involved.

## `remove <module>`

`remove` has no inverse operations. It re-renders the Project **without** the Module and merges, through the same [merge procedure](#the-merge-procedure) as `update` ([Engine](engine.md#ops-catalog)).

1. **Clean tree**, read the Lockfile.
2. **Check dependents first.** Find the selected Modules that `requires` a Capability or Extension point that only the removed Module provides. If any exist, stop with a message naming them and the fix (remove them first, or `--cascade` to include them in the same Plan, listed explicitly). Nothing is built yet at this point.
3. **Dependencies are removed only if unused.** The Modules the removed one had pulled in through `requires` stay unless no remaining Module needs their Capabilities and the user confirms (`--yes` accepts). Dependencies in `package.json` are removed only if no remaining Module's `deps` lists them; `deps.<name>` with `source: "user"` is never removed.
4. **Base** is the current state rendered from the Lockfile (all Modules, recorded versions and answers). **New** is the render of the same selection without the Module. **User** is the working tree.
5. **Merge procedure.** Files owned only by the removed Module: if `pristine`, deleted; if `modified`, a conflict (delete vs modify, kept with a warning). Files with several `owners` are re-rendered without that Module's contribution (for example its `package.json` scripts and its `registerAt` entries) and 3-way merged with the user's edits.
6. **Plan, apply, Lockfile.** The Module's entry, its files and its exclusive `deps` disappear from the Lockfile.

Files the user `eject`ed stay exactly as they are; the Plan notes that an ejected file may still reference the removed Module.

## The merge procedure

`add`, `remove`, `update` and `recopy` are the same machine with different inputs. Nothing else in the system edits an existing user file.

Given a **base** (a render of the Project as the Lockfile describes it), a **new** (a render of the target state) and **user** (the working tree):

1. For each path in the union of base and new, read its Ownership mode and drift state from the Lockfile ([hashes](lockfile.md#per-file-hashes)). `seed` and `ejected` files are skipped.
2. **Fast paths.** `pristine` and base equals new: untouched. `pristine` and base differs from new: take new. `deleted`: keep it deleted (see the deliberate-deletion rule).
3. **Created or removed by the render.** In new but not base: create it, unless the user already has an unknown file there, which is a conflict. In base but not new: delete it if `pristine`, otherwise delete-vs-modify (keep, warn).
4. **Modified files.** Normalize to LF, then hand base, user and new to the [`Merger`](lockfile.md#merge-policy) by file type: text through `git merge-file` / `node-diff3`, JSON structurally, binary as `.aokit-new`. The result is written into the VFS, with conflict markers if any.
5. **Renames.** If a Module's [renames manifest](#renames-manifest) maps an old path to a new one, base and user are read at the old path, new at the new path, and the merge is a rename plus a content merge.
6. **Package-manager lockfile** is never merged; `bun install` regenerates it.
7. **Emit** the result as a Plan, with create, update, delete and rename changes and per-Module provenance ([Engine](engine.md#change-types-and-provenance)).

| Command | base | new |
| --- | --- | --- |
| `add` | Lockfile render | render with the Module added |
| `remove` | Lockfile render | render without the Module |
| `update` | Lockfile render (old versions) | render at target versions, migrated answers |
| `recopy` | none (empty) | render at current versions |
| `layout migrate` | Lockfile render, old Layout | render, new Layout |

A Module's declarative Ops are applied by the Engine only while building a render; the merge procedure never replays or reverses an Op. That is why no Op has an inverse.

## Migrations

A Module that changes in a way a plain re-render cannot carry (a renamed answer, a moved Extension point, a changed file layout) ships migrations in its manifest ([`migrations`](module-contract.md#field-table)):

```json
"migrations": [
  { "from": ">=1 <2", "to": "2.0.0", "stage": "before", "script": "migrations/1-to-2.before.js" },
  { "from": ">=1 <2", "to": "2.0.0", "stage": "after",  "script": "migrations/1-to-2.after.js" }
]
```

- `from` is a semver range of the installed version, `to` the version being installed. A migration runs when the update crosses it, in order of `to`, chained across several versions.
- `stage: "before"` runs on the user's VFS before the new render; `"after"` runs on the merged VFS.
- A migration is a **VFS codemod**: it receives the VFS, the Module's answers and the injected context, and edits them. It may **migrate answers** (rename or add a key, derive a value), which the new render then uses; the migrated answers are written to the Lockfile.
- Migrations are code and only run from a [trusted Registry](module-contract.md#trusted-registries-and-arbitrary-code). They run serially, are deterministic, and appear in the Plan with the Module as provenance.
- When an Extension point has a major bump, the base Module ships the migration ([Capabilities](capabilities.md#extension-points)).

### Renames manifest

A Module version may include `renames.json`, a map from old path to new path (Target-relative, so it works in any Layout). The merge procedure uses it to carry the user's edits across a move instead of treating it as a delete plus a create.

## `doctor`

Read-only health report.

1. Load the Lockfile; check `lockfileVersion` and `minCliVersion`.
2. Verify each Module's `integrity` against the Registry or cache.
3. Re-run Resolver checks against the recorded selection: Capabilities satisfied, Cardinality, `conflicts`.
4. Classify every file in `files` as `pristine`, `modified`, `deleted` or `unknown` ([hashes](lockfile.md#per-file-hashes)) and list files under Targets that are not in the Lockfile.
5. Check that `deps` in `package.json` match the recorded `version` and `pinned` state.

The output is grouped and actionable: for each problem, the command that fixes it (`aokit restore`, `aokit eject`, `aokit update`). It exits non-zero when something is wrong.

## `eject` and `restore`

- `eject <path>`: sets the file's Ownership mode to `ejected` and records it in the Lockfile. The file's content is not changed. From then on `update`, `remove` and `doctor` skip it.
- `restore <path>`: renders the file's `owners` at their Lockfile versions and writes it, replacing the user's version after showing a diff (clean tree required). It works for an `ejected` file (mode returns to `managed`), a `modified` one, and a `deleted` one. If the file has no entry in the Lockfile, it fails.

## `diff`

Renders the Lockfile state in a VFS and prints a unified diff between it and the working tree, per file, for `managed` files. It answers "what have I changed from what aokit generated". `diff --to <release>` instead diffs the working tree against the render at a target release, which previews what `update` would merge.

## `recopy`

For when history is not trustworthy (a lost Module version, a Lockfile gone stale). `recopy` skips the base: it renders the current versions of the selected Modules and treats every `managed` file as `new`, with the user's version as the other side and no common ancestor. Conflicts are therefore more likely and are reported the same way. It keeps `seed` and `ejected` files and rebuilds the Lockfile from the result.
