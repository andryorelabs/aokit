# Lockfile and state

The Lockfile, `aokit.lock.json`, is the recorded state of a Project. Every lifecycle command in [lifecycle](lifecycle.md) reads it; every apply writes it, last and atomically ([Engine](engine.md#atomic-writes)). This page fixes its format, the Ownership modes, how per-file hashes are used, and the merge policy. Vocabulary follows [CONTEXT.md](../../CONTEXT.md). Related: [overview](overview.md), [Module contract](module-contract.md), [Layouts](layouts.md), [versions](versions.md).

The Lockfile is not a manifest: a manifest describes a Module, the Lockfile describes a Project. It contains no timestamps and no volatile values, so two identical Projects have byte-identical Lockfiles ([determinism](engine.md#determinism)).

## Field table

| Field | Type | Meaning |
| --- | --- | --- |
| `$schema` | URL string | JSON Schema of the Lockfile format, for editors and validation. |
| `lockfileVersion` | integer | Format version, incremented on any breaking change. See [Lockfile versioning](#lockfile-versioning). |
| `cliVersion` | semver | Version of the CLI that last wrote the file. Informational; never used for compatibility decisions. |
| `protocolVersion` | integer | Registry protocol version the Project was generated against. |
| `layout` | `"single"` \| `"monorepo"` | The [Layout](layouts.md) chosen by the user. Targets resolve the same way on every later command. |
| `registries` | map `name → object` | Registries used by the Project. |
| `registries.<name>.source` | string | URL, local path or giget ref of the Registry. Remote refs are pinned to a commit SHA. |
| `registries.<name>.release` | string | Registry release the [Catalog](versions.md#catalogs) came from. |
| `registries.<name>.minCliVersion` | semver | Lowest CLI that can read this release. Per Registry release, so a new release may demand a newer CLI without invalidating old Projects. |
| `modules` | map `name → object` | Selected Modules, sorted by name. |
| `modules.<name>.version` | semver | Exact Module version. |
| `modules.<name>.registry` | string | Key into `registries`. |
| `modules.<name>.integrity` | string | `sha256-<hex>` of the Module manifest and its files. |
| `modules.<name>.answers` | object | The answers given to this Module, scoped to it. Feeds `{{var}}` ([Engine](engine.md#no-template-engine)) and replays the old render. |
| `files` | map `path → object` | Every generated file, keyed by Project-relative POSIX path, sorted. |
| `files.<path>.owners` | string[] | Modules that contributed to the file, sorted. More than one for merged files such as `package.json`. |
| `files.<path>.mode` | `"managed"` \| `"seed"` \| `"ejected"` | The [Ownership mode](#ownership-modes). |
| `files.<path>.hash` | string | `sha256-<hex>` of the content as aokit last wrote it (LF-normalized, after the format phase). |
| `deps` | map `name → object` | Dependencies aokit added, sorted by name. |
| `deps.<name>.version` | string | The range or exact version written to `package.json`. |
| `deps.<name>.pinned` | boolean | `true` for a [Toolchain pin group](versions.md#toolchain-pin-groups) member or a dependency pinned with `aokit deps pin`. |
| `deps.<name>.source` | `"catalog"` \| `"module"` \| `"user"` | Where the version came from: the Registry release's Catalog, a version fixed in the Module's own manifest, or a user override. |

`mode` in `files` is always the Ownership mode. The POSIX permission bits of a file are a separate matter: they come from the `mode` of the Module's `files` entry in the [manifest](module-contract.md#field-table), are applied on write, and are preserved on merge (see [Merge policy](#merge-policy)). They are read from disk, not stored in the Lockfile.

## Example

```json
{
  "$schema": "https://aokit.dev/schema/lockfile/v1.json",
  "lockfileVersion": 1,
  "cliVersion": "0.1.0",
  "protocolVersion": 1,
  "layout": "monorepo",
  "registries": {
    "aokit": {
      "source": "https://registry.aokit.dev",
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

Keys are sorted at every level and there is no creation or update time. `answers` keys are sorted too.

## Lockfile versioning

- `$schema` points at the versioned JSON Schema; `lockfileVersion` is an integer incremented on any breaking change.
- A CLI reads Lockfiles up to its supported `lockfileVersion`. A newer Lockfile fails with an error telling the user to update the CLI; it is never half-interpreted.
- **Chained migrations.** An older Lockfile is upgraded by running the migrations `v1 → v2`, `v2 → v3`, … in order, each a pure function from one version's JSON to the next. No migration skips a version, so each is tested against exactly one shape. The upgraded Lockfile is written as part of the next apply, never silently on read.
- **`minCliVersion` per Registry release.** Before fetching Modules, the CLI compares its version with `registries.<name>.minCliVersion` for the release in use. If it is too old, the command stops with the exact CLI version needed. This is how a Registry ships a change (for example a manifest `schemaVersion` bump, see [Module contract](module-contract.md#schema-versioning)) without breaking older CLIs on older releases.

## Ownership modes

Each generated file has exactly one Ownership mode, recorded in `files.<path>.mode`.

| Mode | Behavior |
| --- | --- |
| `managed` | Regenerated by `update` and 3-way merged with the user's edits. The default. |
| `seed` | Written once at `create`/`add`. Never regenerated; `update` does not touch it, so the user's edits are never at risk. Starter pages and example config are `seed`. |
| `ejected` | The user's file. aokit never touches it again; `update` and `remove` skip it and `doctor` does not report drift on it. |

The initial mode comes from the Module's `files[].ownership` (default `managed`). `aokit eject <path>` sets a file to `ejected`: the Lockfile entry keeps its `owners` and last `hash` so `restore` knows what to bring back. `aokit restore <path>` returns an `ejected` file (or a drifted `managed` one) to the state a fresh render of its owners would produce, and sets the mode back to `managed`; for a `seed` file it rewrites the seed content. Command flows are in [lifecycle](lifecycle.md#eject-and-restore).

## Per-file hashes

`files.<path>.hash` is the hash of the file as aokit last wrote it. Comparing it with the hash of the file on disk now gives a drift state without rendering anything:

| State | Condition |
| --- | --- |
| `pristine` | On disk, hash equals the recorded hash. |
| `modified` | On disk, hash differs. |
| `deleted` | In the Lockfile, absent on disk. |
| `unknown` | On disk under a Target a Module writes to, but absent from the Lockfile (created by the user), or in the Lockfile with no readable hash. |

Three commands use this:

- **`doctor`** lists every file by state and checks the rest of the Lockfile (integrity of each Module, `minCliVersion`, Capabilities still satisfied). It is read-only. Details in [lifecycle](lifecycle.md#doctor).
- **Fast-path update.** In `update`, a `managed` file that is `pristine` and whose new render differs is simply overwritten, and one that is `pristine` and whose new render is identical is skipped; neither needs a merge. Only `modified` files enter the [merge procedure](lifecycle.md#the-merge-procedure). A deliberate deletion is a `deleted` file and is respected.
- **Safe `remove`.** A Module's file that is `pristine` and owned only by that Module is deleted without asking; a `modified` one is a conflict; a file with several `owners` is re-rendered without the removed Module and merged ([lifecycle](lifecycle.md#remove-module)).

Hashes are taken over LF-normalized content after the format phase, matching what the Engine wrote, so a Windows checkout with CRLF is not reported as `modified`. Volatile values are excluded ([determinism](engine.md#determinism)).

## Merge policy

All 3-way merging goes through one `Merger` interface: `merge(base, ours, theirs, path) → { content, conflicts }`. `git merge-file` is the primary implementation; `node-diff3` is the fallback when git is not available or the file is outside a repository. The two produce the same conflict marker format, so the rest of the system does not know which ran.

| Case | Policy |
| --- | --- |
| Text file | `Merger`: `git merge-file` primary, `node-diff3` fallback. Conflicts leave markers in the file. |
| Binary file | Never merged. If `theirs` differs from the user's file, the new version is written next to it as `<name>.aokit-new` and the conflict is reported. |
| JSON / JSONC | Merged structurally (by key, arrays by value) with the same patchers as the [Engine](engine.md#non-ts-patchers), not line by line. Keys are emitted sorted. |
| Package-manager lockfiles (`bun.lock`) | Never merged. If `package.json` changed, the file is regenerated by reinstalling. |
| Delete vs modify | If the user modified a file that the new render deletes, or deleted a file that the new render modifies, the file is kept as the user left it and a warning is printed. Nothing is deleted on a doubt. |
| Line endings | Everything is normalized to LF before hashing and merging. |
| File modes | POSIX permission bits (such as the executable bit on hooks) are preserved from the user's file; if the new render changes the bit and the user did not, the new bit applies. |
| `seed` and `ejected` files | Not merged; never passed to the `Merger`. |

## Old module versions stay fetchable

The old render that `update` and `remove` need is rebuilt from the Module version and answers recorded in the Lockfile, so every published Module version must remain fetchable. Registries therefore treat versions as immutable: a published `name@version` never changes content, and the Lockfile `integrity` is checked on every fetch. A mismatch aborts the command with the Module named. The Registry client may keep an optional local cache of fetched versions to work offline; the cache is keyed by `integrity`, so it can never serve a changed Module. If an old version is gone and not cached, `update` fails with a clear error rather than guessing a base; `recopy` ([lifecycle](lifecycle.md#recopy)) is the way out.
