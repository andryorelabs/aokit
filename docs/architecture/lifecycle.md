# Lifecycle

`create` is the first command of a Project's life, not the last. This page specifies the commands that keep a Project maintainable: what each one reads, builds and writes. All of them are built from the same parts: the [Resolver](capabilities.md#resolution-order), the [Engine](engine.md) (VFS, Plan, atomic apply) and the [Lockfile](lockfile.md). Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Related: [overview](overview.md), [Module contract](module-contract.md), [Layouts](layouts.md), [versions](versions.md).

## Command reference

| Command                                 | Purpose                                                            | Writes                              |
| --------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| `create [dir]`                          | Build a new Project from a selection.                              | Whole Project and Lockfile.         |
| `create --from <lockfile\|url>`         | Same, replaying another Project's Lockfile. A local path or a URL. | Whole Project and Lockfile.         |
| `add <module>`                          | Add a Module, plus any Modules it requires.                        | Plan changes, Lockfile.             |
| `remove <module>`                       | Remove a Module.                                                   | Plan changes, Lockfile.             |
| `update`                                | Move Modules to newer versions.                                    | Plan changes, Lockfile.             |
| `update --plan` / `--apply` / `--abort` | Two-phase update.                                                  | Plan file / Plan changes / nothing. |
| `doctor`                                | Report drift and Lockfile health. Read-only; there is no `--fix`.  | Nothing.                            |
| `eject <path>`                          | Hand a file to the user for good. Needs no clean tree.             | Lockfile only.                      |
| `restore <path>`                        | Bring a file back to the rendered state.                           | One file, Lockfile.                 |
| `diff`                                  | Show how the working tree differs from a fresh render.             | Nothing.                            |
| `check`                                 | Say whether an update is available (CI).                           | Nothing.                            |
| `recopy`                                | Re-render everything at the Lockfile versions, ignoring history.   | Plan changes, Lockfile.             |

The commands ship in two phases. Phase 4a (foundations): `doctor`, `diff`, `check`, `eject`, `restore`, `add`, `remove`, `recopy` and `create --from <path>`. Phase 4b: `update` and its `--plan` / `--apply` / `--abort` flags, Module migrations, the renames manifest and the N-1 to N upgrade job. Phase 5a: `create --from <url>` and remote Registries. `layout migrate` follows in phase 8 ([roadmap](../roadmap.md#8-layout-migration-and-engine-debt)). Sections below that describe `update`, [Migrations](#migrations) and [Renames manifest](#renames-manifest) are the design that phase 4b implements.

Every command that builds a Plan accepts `--dry-run` and `--diff` ([Engine](engine.md#vfs-and-plan-before-apply)). Flags, `--json`, `--yes` and the full exit-code table belong to the CLI UX design; this page names only the exit codes that carry lifecycle meaning.

### Clean-tree precondition

Commands that write project files (`add`, `remove`, `update`, `recopy`, `restore`, `layout migrate`) require a clean working tree when the Project is inside a git repository. The check covers the **whole tree**, not only the files the Plan would touch: any uncommitted change, including untracked files that `.gitignore` does not cover, is dirty. It runs **before anything is built**, so a dirty tree stops the command with exit `5` and the list of dirty paths and no Plan exists yet. The point is that the user's own work is always recoverable with git and that a conflict in the merge can only come from committed edits. `--allow-dirty` skips the check explicitly; there is no implicit skip. A gitignored dirty file passes. Outside a git repository, the check is replaced by comparing against the Lockfile hashes and a warning that no undo exists. Read-only commands and `eject` (which writes only the Lockfile) do not need a clean tree.

## `create`

1. **Collect.** Layout, Modules and answers from flags, prompts or `--from`.
2. **Fetch, resolve, build.** As in the [overview flow](overview.md#the-create-and-add-flow): fetch with integrity, resolve Capabilities, build in an empty VFS, run the pinned format phase.
3. **Plan.** `--dry-run` / `--diff` stop here.
4. **Apply.** Atomic write; the Lockfile is written last.
5. **Install.** `bun install` runs after apply, outside the deterministic phase. `--no-install` skips it. An install failure leaves the applied Project in place, exits `1` and tells the user to rerun `bun install`.
6. **Print the reproducible command** (below).

### `create --from <lockfile|url>`

Replaces step 1 with the contents of an existing Lockfile: a local path, or a URL (including a raw file in a git repository). A URL is fetched with the same trust rules as any remote Registry, and a failed fetch is `REGISTRY_FETCH_FAILED`. Layout, Module versions, answers and Registries are taken from it; Registry sources and integrity are re-verified. The user's Project becomes a replay of the source one and gets its own fresh Lockfile, equal to the source Lockfile when the source Project is pristine. There is no preset mechanism: reusable selections are the Lockfile of a real Project. Flags given alongside `--from` override single answers, not Module versions.

### Reproducible command

After `create` and `add`, the CLI prints one command line that reproduces the selection non-interactively, with every answer as an explicit flag:

```text
bunx create-aokit my-app --layout monorepo --modules next,oxc --answer next.appRouter=true --yes
```

It is derived from the Lockfile, so it is the same for any CLI version that wrote the same state, and it is also what `--json` returns in a `reproduce` field.

## `add <module>`

1. Require a clean tree (before anything is built).
2. Load the Lockfile; fetch the new Module (and any auto-accepted providers of its `requires`) with integrity.
3. Resolve over the **existing Modules plus the new one**, so Cardinality, `conflicts` and Extension point ranges are checked against the whole Project ([Capabilities](capabilities.md#deriving-compatibility)). The Modules the user named are recorded as Selected Modules (`selected: true`); providers pulled in through `requires` are `selected: false`. Answers are asked only for the new Modules.
4. Render the **base** from the Lockfile ([Render](#render-from-the-lockfile)), render the target selection as **new**, and enter the [merge procedure](#the-merge-procedure).
5. Show the Plan; apply transactionally; update the Lockfile. A seed file of the new Module is created. Run `bun install` when `package.json` changed.

A Resolver rejection exits `4`, a failed precondition `5` and a merge that leaves conflicts `6`.

Because the Module reaches others only through Capabilities and Extension points, nothing here edits another Module's files except through Ops at declared Extension points, which are the shared files' normal `owners` ([Lockfile](lockfile.md#field-table)).

## `update`

`update` is Copier-style: it renders what aokit would have produced, compares that with what the user has, and merges.

1. **Clean tree**, then read the Lockfile and resolve the **target** Release: the latest Release in the Registry index, or `--to <release>`. The target Release fixes every Module version ([ADR 0016](../adr/0016-update-moves-a-project-between-releases.md)). A target older than the Lockfile's Release is a usage error (exit `3`), and a Module absent from the target Release fails with `MODULE_VERSION_UNAVAILABLE`. Check `minCliVersion`. A Project already at the target exits `0` with "nothing to update" and writes nothing.
2. **Render the old state** in a VFS: the Modules at the versions and answers recorded in the Lockfile, same Layout, same pinned format phase. This is the _base_. Old versions are fetchable by design ([Lockfile](lockfile.md#old-module-versions-stay-fetchable)).
3. **Diff old to user.** For each file, compare the base with the working tree. The recorded `hash` makes this cheap: a `pristine` file equals its base without rendering it, so the render is only needed for `modified` files ([hashes](lockfile.md#per-file-hashes)).
4. **Run `before` migrations** for each Module whose version crosses a migration range ([Migrations](#migrations)). They run on the _user's_ VFS and can rewrite answers, so the new render uses the migrated answers.
5. **Render the new state** in a VFS: target versions, migrated answers. This is _theirs_.
6. **Merge** base, user and new through the [merge procedure](#the-merge-procedure), with the [Renames manifest](#renames-manifest) of every version crossed. Dependencies with `pinned: true` or `source: "user"` are never changed; the Plan lists them as kept.
7. **Run `after` migrations** on the merged VFS.
8. **Plan.** `--dry-run`, `--diff` or `--plan` stop here.
9. **Apply.** Atomic write; the Lockfile is rewritten with new versions, `integrity`, hashes and `deps`.
10. **Install.** `bun install` if `package.json` changed; the Bun lockfile is regenerated, never merged.

Like `add`, `update` shows the Plan and asks for confirmation; without a TTY it needs `--yes` and otherwise fails with `MISSING_VALUE` (exit `3`). `--plan` and `--abort` never prompt.

**Respect deliberate deletions.** A file that is in the Lockfile but absent on disk (state `deleted`) was removed by the user. If the new render still contains it, `update` does not recreate it. If the new render modified it, that is the delete-vs-modify case: the file stays deleted, and a warning is printed, with no conflict and no exit `6` ([merge policy](lockfile.md#merge-policy)). `restore <path>` brings it back.

### Conflicts

When the `Merger` cannot reconcile a file, `update` leaves the conflict **in the working tree**:

- The file contains conflict markers (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`) with the base, user and new versions labeled.
- In a git repository, the index gets the three **stages** for the path (1 base, 2 user, 3 new), so `git status` shows the file as unmerged and `git mergetool` works. Resolving it and running `git add` is the user's way to finish; aokit never stages anything on its own.
- Binary conflicts leave the user's file and write `<name>.aokit-new` beside it.
- The Lockfile is written for the non-conflicted state; conflicted files keep their previous `hash`, so `doctor` reports them as `modified` until resolved, and `update` can be re-run.
- The exit code is `6` and the output lists the conflicted paths with their provenance (which Module and version). Exit `6` applies to every writing command that leaves a Conflict (`add`, `remove`, `recopy`, `update`, `layout migrate`), not only `update`.
- For `update`, the [stash of originals](#transactional-apply) is **kept** and a marker `<git-dir>/aokit/update.json` (`.aokit/update.json` outside git) records the stash directory, the conflicted paths, the `.aokit-new` files written and the previous Lockfile. `doctor` reports the marker with the fix `aokit update --abort` and never deletes a marked stash.
- The marker has a `kind`: `update` (also when the field is absent, as in markers written before `layout migrate`) or `layout-migrate`. `layout migrate` keeps its stash the same way, and `doctor` names the command that owns the marker. `update --abort` on a `layout-migrate` marker, and `layout migrate --abort` on an `update` marker, fail with `INVALID_INPUT` (exit `3`) naming the owning command and touch nothing.

### `update --plan`, `--apply`, `--abort`

Two-phase update for CI and review.

- `update --plan` runs steps 1 to 8 and writes the Plan to `<git-dir>/aokit/plan.json` (`.aokit/plan.json` outside git), outside the working tree. The file holds the CLI version, the target Release, the hash of the Lockfile, the hash of every user file read, the Plan changes with their content (binary as base64), the Conflicts and the target Lockfile. It changes nothing in the Project.
- `update --apply` applies exactly that Plan. If any recorded hash or the Lockfile has changed since the plan, it fails with `PLAN_STALE` (exit `5`) naming the file and asks for a new `--plan`; with no saved plan it fails with `PLAN_MISSING` (exit `5`). What the user reviewed is what is written ([Engine](engine.md#vfs-and-plan-before-apply)). A successful apply deletes the plan.
- `update --abort` deletes a saved Plan, and after a conflicted `update` or `--apply` restores the originals from the kept stash and the previous Lockfile, clears the index stages of the conflicted paths, deletes the `.aokit-new` files that were written and removes the marker. With nothing to abort it exits `0`.

### `check`

Read-only. Reads the configured local or bundled Registry index (phase 4a uses no network) and compares the Lockfile's Module versions and Registry release with what is available.

- Exit 0: up to date.
- Exit **2**: an update is available, reported as the `UPDATE_AVAILABLE` [outcome](cli-ux.md#lifecycle-outcomes). Meant for a scheduled CI job that opens an issue or a branch.
- Exit 1: the Registry cannot be read.
- Other non-zero codes follow the general exit-code table.

`check --json` carries `{ "modules": [{ "name", "current", "available", "migration" }] }` as the `data` of the `UPDATE_AVAILABLE` envelope.

## `remove <module>`

`remove` has no inverse operations. It re-renders the Project **without** the Module and merges, through the same [merge procedure](#the-merge-procedure) as `update` ([Engine](engine.md#ops-catalog)).

1. **Clean tree**, read the Lockfile.
2. **Check dependents first.** Find the remaining Modules that `requires` a Capability or Extension point that only the removed Module provides. If any exist, stop with `DEPENDENTS_EXIST` (exit `4`) naming them and the fix (remove them first, or `--cascade` to include them in the same Plan, listed explicitly). Removing a Module that is not a Selected Module fails with `NOT_SELECTED` (exit `3`). Nothing is built yet at this point.
3. **Orphans are removed only if unused and confirmed.** The Modules the removed one had pulled in through `requires` (`selected: false`) stay unless no remaining Module needs their Capabilities and the user confirms (`--yes` accepts). Non-interactive without `--yes`, the command fails with `MISSING_VALUE` (exit `3`) listing the orphans. Dependencies in `package.json` are removed only if no remaining Module's `deps` lists them; `deps.<name>` with `source: "user"` is never removed.
4. **Base** is the current state rendered from the Lockfile (all Modules, recorded versions and answers). **New** is the render of the same selection without the Module. **User** is the working tree.
5. **Merge procedure.** Files owned only by the removed Module: if `pristine`, deleted; if `modified`, **kept with a warning**, not a Conflict, so the exit code is not `6` for that case. Files with several `owners` are re-rendered without that Module's contribution (for example its `package.json` scripts and its `registerAt` entries) and 3-way merged with the user's edits. A `seed` file of the removed Module is deleted only if it is `pristine` and solely owned; an edited seed is kept with a warning.
6. **Plan, apply, Lockfile.** The Module's entry and its exclusive `deps` disappear from the Lockfile. A file that was kept stays in the Lockfile with the removed Module dropped from its `owners`; the entry is removed when no owners remain.

Files the user `eject`ed stay exactly as they are; the Plan notes that an ejected file may still reference the removed Module. With no user edits, the result equals a fresh `create` without the Module (and without any cascaded Modules).

## The merge procedure

`add`, `remove`, `update` and `recopy` are the same machine with different inputs. Nothing else in the system edits an existing user file.

Given a **base** (a render of the Project as the Lockfile describes it), a **new** (a render of the target state) and **user** (the working tree):

The user side is read only for paths that are in the Lockfile or in either render. The merge itself is a pure VFS-to-VFS function; only reading the user's files touches the disk.

1. For each path in the union of base and new, read its Ownership mode and [Drift state](lockfile.md#per-file-hashes) from the Lockfile. `ejected` files are skipped. `seed` files are never merged: a new seed is created, and a seed that the render removes is deleted only if it is `pristine` and solely owned.
2. **Fast paths.** `pristine` and base equals new: untouched. `pristine` and base differs from new: take new. `deleted`: keep it deleted with a warning when new changed it (see the deliberate-deletion rule). `volatile` files keep the user's content.
3. **Created or removed by the render.** In new but not base: create it, unless the user already has an `unknown` file there, which is a Conflict. In base but not new: delete it if `pristine`; if `modified`, keep it with a warning (no Conflict), and drop the Module from the file's `owners`.
4. **Modified files.** Normalize to LF, then hand base, user and new to the [`Merger`](lockfile.md#merge-policy) by file type: text through `git merge-file` / `node-diff3`, JSON structurally, binary as `.aokit-new`. The result is written into the VFS, with conflict markers if any. Formatting runs only on renders, never on the user's content.
5. **Renames** (phase 4b). If a Module's [renames manifest](#renames-manifest) maps an old path to a new one, base and user are read at the old path, new at the new path, and the merge is a rename plus a content merge. Without a manifest a rename is never inferred from identical content: it is a delete plus a create.
6. **Package-manager lockfile** is never merged; `bun install` regenerates it.
7. **Emit** the result as a Plan, with create, update, delete and rename changes and per-Module provenance ([Engine](engine.md#change-types-and-provenance)).

| Command          | base                           | new                                         |
| ---------------- | ------------------------------ | ------------------------------------------- |
| `add`            | Lockfile render                | render with the Module added                |
| `remove`         | Lockfile render                | render without the Module                   |
| `update`         | Lockfile render (old versions) | render at target versions, migrated answers |
| `recopy`         | none (empty)                   | render at the Lockfile versions             |
| `layout migrate` | Lockfile render, old Layout    | render, new Layout                          |

A Module's declarative Ops are applied by the Engine only while building a render; the merge procedure never replays or reverses an Op. That is why no Op has an inverse.

## Migrations

Phase 4b. A Module that changes in a way a plain re-render cannot carry (a renamed answer, a moved Extension point, a changed file layout) ships Migrations in its manifest ([`migrations`](module-contract.md#field-table)):

```json
"migrations": [
  { "from": ">=1 <2", "to": "2.0.0", "stage": "before", "script": "migrations/1-to-2.before.js" },
  { "from": ">=1 <2", "to": "2.0.0", "stage": "after",  "script": "migrations/1-to-2.after.js" }
]
```

- `from` is a semver range of the installed version, `to` the version being installed, and `script` a path relative to the Module version's directory. A migration is selected when the installed version satisfies `from` and `installed < to <= target`. Modules run in canonical Resolver order and, within a Module, in order of `to`, chained across several versions.
- `stage: "before"` runs on the user's VFS before the new render; `"after"` runs on the merged VFS.
- A migration is a **VFS codemod** written in TypeScript with `defineMigration` from `@aokit/module`, compiled by `registry:build` into the version's `migrations/` directory and covered by its integrity. It receives the VFS, the Module's answers and the injected context, and edits them. It may **migrate answers** (rename or add a key, derive a value), which the new render then uses; the migrated answers are written to the Lockfile.
- Migrations are code and only run from a [trusted Registry](module-contract.md#trusted-registries-and-arbitrary-code). In phase 4b only `local` and `bundled` Registries exist and both are trusted without a prompt. They run serially, are deterministic, and appear in the Plan with the Module as provenance. A migration that throws stops the update before anything is written, with `MIGRATION_FAILED` (exit `1`) naming the Module, the script and the `from` to `to` jump.
- When an Extension point has a major bump, the base Module ships the migration ([Capabilities](capabilities.md#extension-points)).

### Renames manifest

Phase 4b. A Module version may include `renames.json`, a map from the previous version's path to this version's path (Target-relative, so it works in any Layout), stored beside `module.json` and covered by the version's integrity. The merge procedure uses it to carry the user's edits across a move instead of treating it as a delete plus a create. When an update crosses several versions the manifests compose in version order (`a` to `b`, then `b` to `c`, gives `a` to `c`). An `ejected` file is skipped and stays at its old path.

## `doctor`

Read-only health report.

1. Load the Lockfile; check `lockfileVersion` and `minCliVersion`.
2. Verify each Module's `integrity` against the Registry or cache.
3. Re-run Resolver checks against the recorded selection: Capabilities satisfied, Cardinality, `conflicts`. A Resolver error carries its raw Resolver code in the report data.
4. Classify every file in `files` as `pristine`, `modified`, `deleted`, `unknown` or `volatile` ([Drift state](lockfile.md#per-file-hashes)). `unknown` covers files under the Targets that are not in the Lockfile and any `<name>.aokit-new` file. `ejected` files report no drift.
5. Check that `deps` in `package.json` match the recorded `version` and `pinned` state.
6. Report a leftover [stash](#transactional-apply) from an interrupted apply and remove it, unless an `update.json` marker names it: that stash is reported with the fix `aokit update --abort` and kept.

`doctor` is **read-only**: it has no `--fix`, and it removes only a leftover stash. The output is grouped and actionable: for each problem, the command that fixes it (`aokit restore <path>`, `aokit eject <path>`, `aokit add` / `aokit remove`, and `aokit update` once it exists). It exits `0` when clean, `1` with the `DRIFT` [outcome](cli-ux.md#lifecycle-outcomes) and the full report as data when anything is wrong, and `5` when the Lockfile is missing or unreadable.

## `eject` and `restore`

- `eject <path>`: sets the file's Ownership mode to `ejected` and records it in the Lockfile, keeping its `owners` and last `hash`. Only `aokit.lock.json` is written, so no clean tree is needed. It is allowed on `managed` and `seed` files. From then on `update`, `remove` and `doctor` skip it. A path with no Lockfile entry fails with `NOT_IN_LOCKFILE` (exit `3`).
- `restore <path>`: requires a clean tree. It takes a **full Render** at the Lockfile versions, picks that path's content, shows a diff and writes it, replacing the user's version. It works for an `ejected` file, a `modified` one and a `deleted` one; the mode returns to `managed`, and a `seed` stays `seed`. If the file has no entry in the Lockfile, it fails with `NOT_IN_LOCKFILE`.

## `diff`

Renders the Lockfile state in a VFS and prints a unified diff between it and the working tree, per file, for `managed` files only, with real line hunks. It answers "what have I changed from what aokit generated". It exits `0` whether or not there are differences (`3` on invalid input); `--json` returns the hunks per file. `diff --to <release>` (phase 4b) instead diffs the working tree against the render at a target Release, with answers migrated by the `before` Migrations and without merging, which previews what `update` would merge. It exits `0`, or `3` for an invalid or older Release.

## `recopy`

For when history is not trustworthy (a lost Module version, a Lockfile gone stale). It requires a clean tree. `recopy` skips the base: it renders the selected Modules at their **Lockfile versions** and treats every `managed` file as `new`, with the user's version as the other side and no common ancestor. When a locked version is unavailable in the Registry, it uses the latest version of the Lockfile's Release and notes the substitution in the Plan. `pristine` files take new, `deleted` files stay deleted, and a differing `managed` file is a two-way Conflict (user against new, empty base), reported the same way as any other. It keeps `seed` and `ejected` files and rebuilds the Lockfile from the result. Exit `6` on Conflicts.

## Render from the Lockfile

Every command that needs a base uses one function: it takes a Lockfile and produces the [Render](../../GLOSSARY.md) of the Project it describes.

- It starts from an **empty tree** and uses the Lockfile's Layout, Module versions, answers and the Catalog of its Release.
- The context is deterministic (fixed `now` and `random`) and the format phase is the running CLI's, so a Render of an unedited Project reproduces every recorded `managed` and `seed` hash.
- It resolves `registries.<name>.source`: `"bundled"` is the Registry shipped with the CLI, and a relative path resolves from the Project directory.
- It checks `minCliVersion` before reading any Registry (exit `5`, `MIN_CLI_VERSION`).
- A Module version that is not in the Registry fails with `MODULE_VERSION_UNAVAILABLE`, naming the Module, the version and `aokit recopy` as the way out.
- Building a Render applies the manifest `deps` and `env` itself, so it never depends on the wrapper that calls it. Building over a non-empty base requires the previous Lockfile.

## Transactional apply

Applying a Plan to an existing Project is transactional:

1. Every file the Plan will overwrite or delete is first copied to `<git-dir>/aokit/stash/<timestamp>/` (resolved with `git rev-parse --git-dir`, so a linked worktree works), or to `.aokit/stash/` outside git.
2. The Plan is committed. On an I/O error part-way, the originals are restored and the command exits `1`; the Lockfile is unchanged.
3. On success the stash is removed. A conflicted `update` keeps it for `update --abort` (marked by `update.json`). `doctor` reports and removes an unmarked stash left by a killed process.
4. A **conflict writer** then writes merged content with markers, writes `<name>.aokit-new` siblings for binaries, and in a git repository records index stages 1, 2 and 3 for each conflicted path. It never runs `git add` or `git commit`.
5. The Lockfile is written last. Conflicted files keep their previous `hash`, so `doctor` reports them `modified`.
