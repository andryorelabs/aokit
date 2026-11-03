# 0011. File ownership modes and per-file hashes

Status: Accepted (2026-11-03)
Spec: S7 (AO-2673)
Architecture: [Lockfile: ownership modes](../architecture/lockfile.md#ownership-modes), [Lockfile: per-file hashes](../architecture/lockfile.md#per-file-hashes), [Lifecycle: eject and restore](../architecture/lifecycle.md#eject-and-restore)

## Context

After generation the user edits files. aokit must know, per file, whether it may regenerate it, whether it was edited, and whether the user took it over.

## Decision

The Lockfile `files` map records for each path `{owners, mode, hash}`. Mode is `managed` (regenerated and 3-way merged, the default), `seed` (written once, never regenerated) or `ejected` (the user's, never touched again). `aokit eject <path>` and `aokit restore <path>` move files between modes. The hash is taken over LF-normalized content after the format phase and yields a drift state (`pristine`, `modified`, `deleted`, `unknown`) without rendering. `doctor`, fast-path `update` and safe `remove` all use it. `aokit.lock.json` has sorted keys and no timestamps.

## Consequences

- `update` skips a render for pristine files and never touches `seed` or `ejected` files.
- Deliberate deletions are respected.
- The Lockfile grows with the file count and must stay deterministic.
- A format-phase change alters hashes, which is why the formatter is a Toolchain pin group.

## Alternatives considered

- **No per-file state; always merge**: rejected because it cannot skip pristine files or honor ownership.
- **One project-wide ownership flag**: rejected because users need to own one file without leaving the rest.
