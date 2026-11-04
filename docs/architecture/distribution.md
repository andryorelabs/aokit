# Distribution

How aokit is built, published and verified. Related: [overview](overview.md), [Engine](engine.md) (determinism), [CLI UX](cli-ux.md), [Interfaces](interfaces.md). Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md).

## Bun only

aokit and the Projects it generates are Bun-only. There is no package-manager abstraction and no npm or pnpm path.

```text
bunx create-aokit my-app
bunx aokit add auth
```

- `create-aokit` is a thin package whose bin runs `aokit create`; it exists so `bun create aokit` and `bunx create-aokit` work.
- The `aokit` package is developed and tested on Bun and published as a normal npm package: `bun build --target bun` bundles the CLI into `dist/` with `@aokit/module` inlined, and the first-party Registry travels in the same tarball. It uses Bun APIs directly (`Bun.semver`, `Bun.spawn`, `Bun.CryptoHasher`, `Bun.file`), declares `engines.bun` and starts with a `bun` shebang. There is no Node install path and no adapter hiding the Bun APIs ([ADR 0006](../adr/0006-bun-only.md)). `@aokit/module`, the SDK for Module authors, is not published in the first versions.
- Dependency installation after apply is always `bun install` and runs outside the [deterministic phase](engine.md#determinism).

## Compiled binary

A standalone binary is built per platform with `bun build --compile` (linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64). It is for people and CI images that do not have Bun yet.

Settings and constraints:

- **`autoloadDotenv: false` and `autoloadBunfig: false`.** A compiled binary otherwise loads `.env` and `bunfig.toml` from the directory it is run in, which would leak the user's Project configuration into the CLI and break [determinism](engine.md#determinism). Both are disabled at compile time.
- **Modules are static or assets.** Bun does not embed dynamic imports it cannot resolve at build time. The first-party Registry (Module manifests, plain source files and Migration scripts) is embedded as assets. On first use (lazily, when a command opens the bundled Registry; `--version` never extracts) the binary extracts it atomically (temporary directory, then rename) to `<cache>/bundled-registry/<content-hash>/` under the aokit cache directory and reads it from disk like every other local Registry, so there is one read path. An extraction failure, such as an unwritable cache directory, fails the command with `REGISTRY_EXTRACT_FAILED` (an `IO_ERROR` envelope naming the directory and the cause). Migrations are imported from that extracted copy. Modules from other [Registries](module-contract.md#trusted-registries-and-arbitrary-code) are fetched at runtime as data, never imported as code from the binary's filesystem.
- **Native oxc and oxfmt, embedded per target.** The WASM build of oxc-parser does not run on Bun (`wasi.initialize is not a function` on Bun 1.4.4) and oxfmt has no WASM build. Each binary embeds the native bindings of its own target as files (`with { type: "file" }`); a binary-only entry sets `NAPI_RS_NATIVE_LIBRARY_PATH` to the embedded file before importing each package. Cross-compiling needs the target's bindings installed (`bun install --os <os> --cpu <cpu>`). The npm package and the binary therefore run the same parser, and the determinism digest runs against both ([CI](#ci-determinism-on-linux-and-macos)).
- **Optional oxfmt imports are stubbed.** oxfmt imports `@astrojs/compiler-rs` and several prettier plugins that are not installed, so bundling fails. One build plugin, shared by the package bundle and the binary, replaces them with stubs that throw `<name> is not bundled with aokit` if called; no file type of the curated Modules reaches them.
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
5. Run it for both the npm build and the compiled binary, and fail if their digests differ. Both embed the same native parser, so a difference points at bundling, asset embedding or the extraction path.

The digests are stored as snapshots next to the capability-derived matrix, so an unintended change in generated output shows up as a reviewed snapshot diff.
