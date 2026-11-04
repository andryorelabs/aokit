# Distribution

How aokit is built, published and verified. Related: [overview](overview.md), [Engine](engine.md) (determinism), [CLI UX](cli-ux.md), [Interfaces](interfaces.md). Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md).

## Bun only

aokit and the Projects it generates are Bun-only. There is no package-manager abstraction and no npm or pnpm path.

```text
bunx create-aokit my-app
bunx aokit add auth
```

- `create-aokit` is a thin package whose bin runs `aokit create`; it exists so `bun create aokit` and `bunx create-aokit` work.
- The `aokit` package is developed and tested on Bun. It is published as a normal npm package built to plain JavaScript, so `bunx` runs it; Bun-specific APIs (file I/O, spawn, hashing) sit behind a small adapter so the package could also run on Node 22 or later without touching command code. That is a hedge, not a supported install path: generated Projects still require Bun.
- Dependency installation after apply is always `bun install` and runs outside the [deterministic phase](engine.md#determinism).

## Compiled binary

A standalone binary is built per platform with `bun build --compile` (linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64). It is for people and CI images that do not have Bun yet.

Settings and constraints:

- **`autoloadDotenv: false` and `autoloadBunfig: false`.** A compiled binary otherwise loads `.env` and `bunfig.toml` from the directory it is run in, which would leak the user's Project configuration into the CLI and break [determinism](engine.md#determinism). Both are disabled at compile time.
- **Modules are static or assets.** Bun does not embed dynamic imports it cannot resolve at build time. The first-party Modules compiled into the binary are imported statically, or embedded as `assets` (their compiled JSON manifest and plain source files, read through Bun's embedded file API). Modules from other [Registries](module-contract.md#trusted-registries-and-arbitrary-code) are fetched at runtime as data, never imported as code from the binary's filesystem.
- **No native oxc in the binary.** Native add-ons do not embed reliably. The binary uses the WASM build of oxc-parser for the locate step of the [edit engine](engine.md#code-edits-locate-and-splice), or ast-grep patterns, and the npm package may use the native oxc build when available. Both must produce the same spans; the determinism hash test runs against both builds.
- **The binary is not an update channel.** `aokit update` of a Project uses the Registry; the binary only needs a newer CLI when the Lockfile's `minCliVersion` demands it, in which case the error says which download or `bunx` command to use ([exit code 5](cli-ux.md#exit-codes)).

## Publishing to npm

- **Trusted publishing (OIDC).** The release workflow publishes `aokit` and `create-aokit` from GitHub Actions using npm trusted publishing, so no long-lived npm token exists in the repository or in CI secrets.
- **Provenance.** Packages are published with provenance, linking each version to the commit and workflow run that built it.
- The workflow has `id-token: write` only in the publish job; build and test jobs run with read-only permissions. Third-party actions are pinned by commit SHA.

## GitHub Releases

Each release attaches:

- one binary per platform,
- `SHA256SUMS`, a sorted list of hashes of every attached binary,
- build provenance attestations for each binary (`actions/attest-build-provenance`), verifiable with `gh attestation verify <file> --repo <owner>/aokit`.

Verification instructions (download, `sha256sum -c SHA256SUMS`, `gh attestation verify`) are in the release notes and the README. The Registry's own integrity hashes (recorded per Module in the Lockfile) are separate: they cover Modules, not the CLI.

## Release tooling

Two options were compared for versioning, changelog and tagging.

| | changesets | bumpp + changelogithub |
| --- | --- | --- |
| Model | A markdown "changeset" file per change, committed with the PR; a bot opens a "Version Packages" PR that aggregates them. | The maintainer runs `bumpp` to bump the version, tag and push; `changelogithub` generates GitHub release notes from conventional commits. |
| Fit for monorepo with several packages | Built for it: per-package versions, dependency bumps, linked and fixed groups. | Single version; fine for one version across packages, no per-package logic. |
| Source of release notes | Hand-written changeset text. | Commit messages, which in this repo are already gitmoji + conventional commits with bullet bodies. |
| Extra process | Contributors must add a changeset; a release PR must be merged. | None per change; one command per release. |
| npm trusted publishing | Works; publish step in CI after the release PR merges. | Works; publish step runs on the pushed tag. |
| Maintenance | More moving parts (action, bot PR, config). | Two small tools. |

**Decision: bumpp + changelogithub.** aokit has two packages released together at one version (`aokit` and `create-aokit`), a single maintainer, and commit messages that already follow a strict convention, so generated notes cost nothing and a per-change changeset file would be duplicated effort. The release flow is: `bumpp` creates the version commit and tag, the tag triggers the workflow, which builds, tests, publishes to npm with provenance, builds the binaries, generates `SHA256SUMS` and attestations, and runs `changelogithub` to fill the GitHub Release. Revisit changesets only if the repository grows packages that must version independently.

The release workflow is also the place that publishes the Registry release (Catalog and Module manifests) so a CLI version and the Registry releases it supports stay traceable through `minCliVersion`.

## Telemetry

None in v1. The CLI, the MCP server and generated Projects send no usage data, crash reports or identifiers, and the only network calls are the ones the user asked for: Registry fetches, the npm update check ([CLI UX](cli-ux.md#version-and-update-notices)) and dependency installation. If telemetry is ever added, it will be opt-in, off by default, documented here first, and will honor `DO_NOT_TRACK=1` and `AOKIT_NO_TELEMETRY=1` regardless of any other setting.

## CI: determinism on Linux and macOS

Generation must be byte-identical across machines ([Engine: determinism](engine.md#determinism)). CI enforces it:

1. For each Project in the curated set, run `create` twice into separate directories with identical inputs and `now`, `random` and `env` injected.
2. Hash every emitted file, excluding values marked volatile, and hash the sorted list of `path` and file hashes into one digest per Project.
3. Fail if the two digests differ, and diff the trees to show why.
4. Run the same job on a Linux runner and a macOS runner and fail if the digests differ **across** operating systems (this catches path separators, line endings, locale-dependent sorting and file-mode differences).
5. Run it for both the npm build and the compiled binary, since they use different oxc builds.

The digests are stored as snapshots next to the capability-derived matrix, so an unintended change in generated output shows up as a reviewed snapshot diff.
