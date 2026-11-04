# Lockfile and state

The Lockfile, `aokit.lock.json`, is the recorded state of a Project. Every lifecycle command in [lifecycle](lifecycle.md) reads it; every apply writes it, last and atomically ([Engine](engine.md#atomic-writes)). This page fixes its format, the Ownership modes, how per-file hashes are used, and the merge policy. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Related: [overview](overview.md), [Module contract](module-contract.md), [Layouts](layouts.md), [versions](versions.md).

The Lockfile is not a manifest: a manifest describes a Module, the Lockfile describes a Project. It contains no timestamps and no volatile values, so two identical Projects have byte-identical Lockfiles ([determinism](engine.md#determinism)).

## Field table

| Field | Type | Meaning |
| --- | --- | --- |
| `$schema` | URL string | JSON Schema of the Lockfile format, for editors and validation. |
| `lockfileVersion` | integer | Format version, incremented on any breaking change. Currently `2`. See [Lockfile versioning](#lockfile-versioning). |
| `cliVersion` | semver | Version of the CLI that last wrote the file. Informational; never used for compatibility decisions. |
| `protocolVersion` | integer | Registry protocol version the Project was generated against. |
| `layout` | `"single"` \| `"monorepo"` | The [Layout](layouts.md) chosen by the user. Targets resolve the same way on every later command. |
| `registries` | map `name → object` | Registries used by the Project. |
| `registries.<name>.source` | string | `"bundled"` (the Registry shipped with the CLI), a path relative to the Project directory, a URL or a giget ref. Remote refs are pinned to a commit SHA. |
| `registries.<name>.release` | string | Registry release the [Catalog](versions.md#catalogs) came from. |
| `registries.<name>.minCliVersion` | semver | Lowest CLI that can read this release. Per Registry release, so a new release may demand a newer CLI without invalidating old Projects. |
| `modules` | map `name → object` | Selected Modules, sorted by name. |
| `modules.<name>.version` | semver | Exact Module version. |
| `modules.<name>.registry` | string | Key into `registries`. |
| `modules.<name>.selected` | boolean | `true` for a [Selected Module](../../GLOSSARY.md) (named by the user), `false` for one pulled in by `requires`. `remove` uses it to find orphans. |
| `modules.<name>.integrity` | string | `sha256-<hex>` over the canonical manifest and the Module's files, copied verbatim from the Registry index. See [Integrity format](#integrity-format). |
| `modules.<name>.answers` | object | The answers given to this Module, scoped to it. Feeds `{{var}}` ([Engine](engine.md#no-template-engine)) and replays the old render. |
| `files` | map `path → object` | Every generated file, keyed by Project-relative POSIX path, sorted. |
| `files.<path>.owners` | string[] | Modules that contributed to the file, sorted. More than one for merged files such as `package.json`. Always real Module names: workspace wiring that no Module owns gets no entry, and there is no `aokit` pseudo-owner. |
| `files.<path>.mode` | `"managed"` \| `"seed"` \| `"ejected"` | The [Ownership mode](#ownership-modes). |
| `files.<path>.hash` | string | `sha256-<hex>` of the content as aokit last wrote it (LF-normalized, after the format phase). |
| `deps` | map `name → object` | Dependencies aokit added, sorted by name. |
| `deps.<name>.version` | string | The range or exact version written to `package.json`. |
| `deps.<name>.pinned` | boolean | `true` for a [Toolchain pin group](versions.md#toolchain-pin-groups) member or a dependency pinned with `aokit deps pin`. |
| `deps.<name>.owners` | string[] | Modules whose `deps` list the dependency, sorted. `remove` deletes a dependency only when no remaining Module owns it. |
| `deps.<name>.source` | `"catalog"` \| `"module"` \| `"user"` | Where the version came from: the Registry release's Catalog, a version fixed in the Module's own manifest, or a user override. |

`mode` in `files` is always the Ownership mode. The POSIX permission bits of a file are a separate matter: they come from the `mode` of the Module's `files` entry in the [manifest](module-contract.md#field-table), are applied on write, and are preserved on merge (see [Merge policy](#merge-policy)). They are read from disk, not stored in the Lockfile.

## Example

```json
{
  "$schema": "https://aokit.andryore.dev/schema/lockfile/v1.json",
  "lockfileVersion": 1,
  "cliVersion": "0.1.0",
  "protocolVersion": 1,
  "layout": "monorepo",
  "registries": {
    "aokit": {
      "source": "bundled",
      "release": "2026.11.0",
      "minCliVersion": "0.1.0"
    }
  },
  "modules": {
    "next": {
      "version": "1.2.0",
      "registry": "aokit",
      "integrity": "sha256-3f1c0b8e6a9d4f2b7c5e1a0d9b8c7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a",
      "answers": { "appRouter": true }
    },
    "oxc": {
      "version": "1.0.0",
      "registry": "aokit",
      "integrity": "sha256-a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "answers": {}
    }
  },
  "files": {
    ".oxlintrc.json": {
      "owners": ["oxc"],
      "mode": "managed",
      "hash": "sha256-0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"
    },
    "apps/web/package.json": {
      "owners": ["next", "oxc"],
      "mode": "managed",
      "hash": "sha256-9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0"
    },
    "apps/web/src/app/page.tsx": {
      "owners": ["next"],
      "mode": "seed",
      "hash": "sha256-1122334455667788990011223344556677889900112233445566778899001122"
    }
  },
  "deps": {
    "next": { "version": "^16.0.0", "pinned": false, "source": "catalog" },
    "oxlint": { "version": "1.90.0", "pinned": true, "source": "catalog" }
  }
}
```

This block is the v1 shape that the current implementation reads and that a test checks byte for byte. It is replaced by the v2 block below when the v2 implementation lands.

## Example (v2)

```json
{
  "$schema": "https://aokit.andryore.dev/schema/lockfile/v2.json",
  "lockfileVersion": 2,
  "cliVersion": "0.1.0",
  "protocolVersion": 1,
  "layout": "monorepo",
  "registries": {
    "aokit": {
      "source": "bundled",
      "release": "2026.11.0",
      "minCliVersion": "0.1.0"
    }
  },
  "modules": {
    "next": {
      "version": "1.2.0",
      "registry": "aokit",
      "selected": true,
      "integrity": "sha256-3f1c0b8e6a9d4f2b7c5e1a0d9b8c7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a",
      "answers": { "appRouter": true }
    },
    "oxc": {
      "version": "1.0.0",
      "registry": "aokit",
      "selected": true,
      "integrity": "sha256-a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      "answers": {}
    }
  },
  "files": {
    ".oxlintrc.json": {
      "owners": ["oxc"],
      "mode": "managed",
      "hash": "sha256-0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"
    },
    "apps/web/package.json": {
      "owners": ["next", "oxc"],
      "mode": "managed",
      "hash": "sha256-9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0"
    },
    "apps/web/src/app/page.tsx": {
      "owners": ["next"],
      "mode": "seed",
      "hash": "sha256-1122334455667788990011223344556677889900112233445566778899001122"
    }
  },
  "deps": {
    "next": { "version": "^16.0.0", "owners": ["next"], "pinned": false, "source": "catalog" },
    "oxlint": { "version": "1.90.0", "owners": ["oxc"], "pinned": true, "source": "catalog" }
  }
}
```

Keys are sorted at every level and there is no creation or update time. `answers` keys are sorted too. `schema/lockfile/v2.json` is generated from the same schema the CLI validates with, and a test checks that the committed file matches.

## Integrity format

There is one integrity format everywhere: `sha256-<lowercase hex>`, computed over the canonical manifest and the Module's files (each file as its sorted path plus its LF-normalized content). The [Registry index](registry.md#aokit-manifest-index) publishes it, and `modules.<name>.integrity` records the Registry's value verbatim, so the two can be compared by string equality. Per-file hashes in `files` use the same `sha256-<hex>` form. A Registry the user trusted may carry `registries.<name>.trusted: true`, an optional field that lets a clone skip the trust prompt ([Registry](registry.md#trusted-and-untrusted-registries)). A Module whose files differ from its recorded integrity fails to read with an error naming the Registry, the Module and both values.

## Lockfile versioning

- `$schema` points at the versioned JSON Schema; `lockfileVersion` is an integer incremented on any breaking change.
- A CLI reads Lockfiles up to its supported `lockfileVersion`. A newer Lockfile fails with an error telling the user to update the CLI; it is never half-interpreted.
- **Chained migrations.** An older Lockfile is upgraded by running the migrations `v1 → v2`, `v2 → v3`, … in order, each a pure function from one version's JSON to the next. No migration skips a version, so each is tested against exactly one shape. The upgraded Lockfile is written as part of the next apply, never silently on read: reading a v1 file yields a v2 value marked `upgradedFrom: 1` and leaves the file on disk unchanged. The `v1 → v2` migration is the first link of the chain: it marks every Module `selected: true` (a v1 Lockfile did not distinguish) and derives each `deps.<name>.owners` from the Modules' manifests.
- **`minCliVersion` per Registry release.** Before fetching Modules, the CLI compares its version with `registries.<name>.minCliVersion` for the release in use. If it is too old, the command stops with the exact CLI version needed. This is how a Registry ships a change (for example a manifest `schemaVersion` bump, see [Module contract](module-contract.md#schema-versioning)) without breaking older CLIs on older releases.

## Ownership modes

Each generated file has exactly one Ownership mode, recorded in `files.<path>.mode`.

| Mode | Behavior |
| --- | --- |
| `managed` | Regenerated by `update` and 3-way merged with the user's edits. The default. |
| `seed` | Written once at `create`/`add`. Never regenerated; `update` does not touch it, so the user's edits are never at risk. Starter pages and example config are `seed`. |
| `ejected` | The user's file. aokit never touches it again; `update` and `remove` skip it and `doctor` does not report drift on it. |

The initial mode comes from the Module's `files[].ownership` (default `managed`). `aokit eject <path>` sets a file to `ejected`: the Lockfile entry keeps its `owners` and last `hash` so `restore` knows what to bring back. `aokit restore <path>` returns an `ejected` file (or a drifted `managed` one) to the state a fresh render of its owners would produce, and sets the mode back to `managed`; for a `seed` file it rewrites the seed content. Command flows are in [lifecycle](lifecycle.md#eject-and-restore).

### Region files

The root `AGENTS.md` and `CLAUDE.md` are Region files: they are `managed`, and the Merger treats them by [Region](engine.md#marker-regions) instead of by line ([ADR 0020](../adr/0020-agent-files-are-region-files-merged-by-region.md)).

- Each Region the user did not edit is replaced with its next content; a Region the next Render no longer has is deleted; text outside markers is never changed.
- A Region the user edited is 3-way merged on its own, and Conflict markers stay inside it.
- A new Region goes right after the closest earlier Region (in the next Render's order) that the file already has.
- A file with no aokit markers at a path the next Render writes is adopted: the user's text is kept after the inserted Regions, with no Conflict.
- The Lockfile `owners` of these files include the reserved `aokit` owner for the header and `CLAUDE.md`.

## Per-file hashes

`files.<path>.hash` is the hash of the file as aokit last wrote it. For a [Region file](#region-files) it covers only the line-ending-normalized aokit Regions, so text outside markers is not drift and an edit inside a Region is `modified`. Comparing it with the hash of the file on disk now gives a drift state without rendering anything:

| State | Condition |
| --- | --- |
| `pristine` | On disk, hash equals the recorded hash. |
| `modified` | On disk, hash differs. |
| `deleted` | In the Lockfile, absent on disk. |
| `unknown` | On disk under a Target a Module writes to, but absent from the Lockfile (created by the user), or in the Lockfile with no readable hash. Every `<name>.aokit-new` file is reported as `unknown`. |
| `volatile` | A file whose bytes are expected to change outside aokit, such as the package-manager lockfile. It is never reported as drift and its content is never merged: the user's version is kept. |

The states are computed fresh on every run and are **never stored** in the Lockfile. `ejected` files report no drift. Outside git, `unknown` is found by walking the Targets with a fixed exclusion list (`node_modules`, `.git`, `dist`, `.env*`); inside git it comes from `git ls-files --others --exclude-standard`, so ignored files are not reported.

Three commands use this:

- **`doctor`** lists every file by state and checks the rest of the Lockfile (integrity of each Module, `minCliVersion`, Capabilities still satisfied). It is read-only. Details in [lifecycle](lifecycle.md#doctor).
- **Fast-path update.** In `update`, a `managed` file that is `pristine` and whose new render differs is simply overwritten, and one that is `pristine` and whose new render is identical is skipped; neither needs a merge. Only `modified` files enter the [merge procedure](lifecycle.md#the-merge-procedure). A deliberate deletion is a `deleted` file and is respected.
- **Safe `remove`.** A Module's file that is `pristine` and owned only by that Module is deleted without asking; a `modified` one is kept with a warning; a file with several `owners` is re-rendered without the removed Module and merged ([lifecycle](lifecycle.md#remove-module)).

Hashes are taken over LF-normalized content after the format phase, matching what the Engine wrote, so a Windows checkout with CRLF is not reported as `modified`. Volatile values are excluded ([determinism](engine.md#determinism)).

## Merge policy

All 3-way merging goes through one `Merger` interface: `merge(base, user, next, path) → { content, conflict }` for one file. `git merge-file` is the primary implementation inside a repository; `node-diff3` is used outside one. The two produce byte-identical diff3-style conflict markers (labels `base`, `user`, `new`, with a `|||||||` base section), so the rest of the system does not know which ran. A result that needs a human is a **Conflict**.

| Case | Policy |
| --- | --- |
| Text file | `Merger`: `git merge-file` primary, `node-diff3` fallback. Conflicts leave markers in the file. |
| Binary file | Detected by a NUL byte in the first 8 KB. Never merged. If `next` differs from the user's file, the new version is written next to it as `<name>.aokit-new` and the Conflict is reported. |
| JSON / JSONC | Merged structurally (by key, arrays by value) with the same patchers as the [Engine](engine.md#non-ts-patchers), not line by line. The user's key order and comments are preserved, and keys that are new are inserted in sorted position. A scalar changed on both sides falls back to a text merge with markers. |
| Package-manager lockfiles (`bun.lock`) | Never merged. If `package.json` changed, the file is regenerated by reinstalling. |
| Delete vs modify | If the user modified a file that the new render deletes, or deleted a file that the new render modifies, the file is kept as the user left it and a **warning** is printed. It is not a Conflict and does not produce exit `6`. When the render removed the file, the Module is dropped from its `owners` (the entry is removed when none remain). Nothing is deleted on a doubt. |
| Line endings | Everything is normalized to LF before hashing and merging. |
| File modes | POSIX permission bits (such as the executable bit on hooks) are preserved from the user's file; if the new render changes the bit and the user did not, the new bit applies. |
| `seed` and `ejected` files | Not merged; never passed to the `Merger`. A new seed is created; a seed the render removes is deleted only if `pristine` and solely owned. |
| A file the render creates over an `unknown` user file | A Conflict. |
| Conflicted files in the Lockfile | They keep their previous `hash`, so `doctor` reports them `modified` until resolved. |

## Old module versions stay fetchable

The old render that `add`, `remove`, `restore`, `recopy` and `update` need is rebuilt from the Module version and answers recorded in the Lockfile, so every published Module version must remain fetchable. Registries therefore treat versions as immutable: a published `name@version` never changes content, and the Lockfile `integrity` is checked on every fetch. A mismatch aborts the command with the Module named. The Registry client may keep an optional local cache of fetched versions to work offline; the cache is keyed by `integrity`, so it can never serve a changed Module. If an old version is gone and not cached, the command fails with `MODULE_VERSION_UNAVAILABLE` rather than guessing a base; `recopy` ([lifecycle](lifecycle.md#recopy)) is the way out.
