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

A standalone binary is built per platform with `bun build --compile` (linux-x64, linux-arm64, darwin-x64, darwin-arm64, windows-x64), by the [release workflow](#release-workflow). It is for people and CI images that do not have Bun yet.

Settings and constraints:

- **`autoloadDotenv: false` and `autoloadBunfig: false`.** A compiled binary otherwise loads `.env` and `bunfig.toml` from the directory it is run in, which would leak the user's Project configuration into the CLI and break [determinism](engine.md#determinism). Both are disabled at compile time.
- **Modules are static or assets.** Bun does not embed dynamic imports it cannot resolve at build time. The first-party Registry (Module manifests, plain source files and Migration scripts) is embedded as assets. On first use (lazily, when a command opens the bundled Registry; `--version` never extracts) the binary extracts it atomically (temporary directory, then rename) to `<cache>/bundled-registry/<content-hash>/` under the aokit cache directory and reads it from disk like every other local Registry, so there is one read path. An extraction failure, such as an unwritable cache directory, fails the command with `REGISTRY_EXTRACT_FAILED` (an `IO_ERROR` envelope naming the directory and the cause). Migrations are imported from that extracted copy. Modules from other [Registries](module-contract.md#trusted-registries-and-arbitrary-code) are fetched at runtime as data, never imported as code from the binary's filesystem.
- **Native oxc and oxfmt, embedded per target.** The WASM build of oxc-parser does not run on Bun (`wasi.initialize is not a function` on Bun 1.4.4) and oxfmt has no WASM build. Each binary embeds the native bindings of its own target as files (`with { type: "file" }`); a binary-only entry sets `NAPI_RS_NATIVE_LIBRARY_PATH` to the embedded file before importing each package. Cross-compiling needs the target's bindings installed (`bun install --os <os> --cpu <cpu>`). The npm package and the binary therefore run the same parser, and the determinism digest runs against both ([CI](#ci-determinism-on-linux-and-macos)).
- **Optional oxfmt imports are stubbed.** oxfmt imports `@astrojs/compiler-rs` and several prettier plugins that are not installed, so bundling fails. One build plugin, shared by the package bundle and the binary, replaces them with stubs that throw `<name> is not bundled with aokit` if called; no file type of the curated Modules reaches them.
- **The binary is not an update channel.** `aokit update` of a Project uses the Registry; the binary only needs a newer CLI when the Lockfile's `minCliVersion` demands it, in which case the error says which download or `bunx` command to use ([exit code 5](cli-ux.md#exit-codes)).

## Release workflow

`.github/workflows/release.yml` runs on a `v*` tag push, or by hand with `workflow_dispatch` and the input `dry-run` (default `true`). The tag must equal `v<version>` of `packages/aokit/package.json`, and `create-aokit` must have the same version and depend on exactly that `aokit` version. A dry run runs every job and `npm publish --dry-run`, creates no GitHub Release and publishes nothing; a real publish needs a tag ref. Default permissions are `contents: read`.

| Job        | Runs on                                                                      | Does                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`   | `ubuntu-latest`                                                              | Resolves the version, the dist-tag and the dry-run flag; runs `bun run check`, `bun run test`, `build:package` and `lint:package`; packs both tarballs, runs the installed tarball tests and generates the release notes.       |
| `binaries` | a five-target matrix                                                         | Builds one binary per target. linux-x64, linux-arm64 and darwin-arm64 run on native runners and pass the process tests (`AOKIT_BIN`) and the end-to-end and digest comparison tests; darwin-x64 and windows-x64 are built only. |
| `release`  | `ubuntu-latest`, `contents: write`, `id-token: write`, `attestations: write` | Writes `SHA256SUMS`, attests the binaries, adds the verification steps to the notes and creates the GitHub Release (a pre-release for a pre-release version). Needs `verify` and `binaries`.                                    |
| `publish`  | `ubuntu-latest`, `id-token: write`                                           | Checks npm is at least 11.5.1, then publishes `aokit` and then `create-aokit` from the verified tarballs. Needs `verify`, `binaries` and `release`.                                                                             |

The jobs run on GitHub-hosted runners and are never routed to Blacksmith. `id-token: write` appears only in `release` (for the attestations) and `publish` (for npm trusted publishing and provenance); `tools/workflows/release-workflow.test.ts` asserts the triggers, permissions, pinning and the dry-run behavior.

## Publishing to npm

- **Trusted publishing (OIDC).** The `publish` job publishes `aokit` and `create-aokit` with npm trusted publishing, so no long-lived npm token exists in the repository or in CI secrets. Each package must list `release.yml` of this repository as a trusted publisher on npmjs.com.
- **Provenance.** `npm publish --provenance --access public` links each version to the commit and workflow run that built it.
- **Dist-tag.** A version with a pre-release part (`0.1.0-next.0`) publishes with `--tag next`; any other version with `--tag latest` ([ADR 0026](../adr/0026-registry-releases-are-dated-cli-versions-are-semver.md)).
- **First publish.** Trusted publishers can only be configured for a package that exists, so the first `0.1.0-next.0` is published by hand with a short-lived token. [`tools/release/human-steps.sh`](../../tools/release/human-steps.sh) walks the owner through it and the other manual steps, and never stores the token.

## GitHub Releases

Each release attaches:

- the five binaries `aokit-linux-x64`, `aokit-linux-arm64`, `aokit-darwin-arm64`, `aokit-darwin-x64` and `aokit-windows-x64.exe`,
- `SHA256SUMS`, a sorted list of hashes of exactly those binaries,
- a build provenance attestation per binary (`actions/attest-build-provenance`, from the checksum file), verifiable with `gh attestation verify <file> --repo <owner>/aokit`.

The notes list the changes (`changelogithub`) and the verification steps: download the binaries and `SHA256SUMS` into one directory, run `sha256sum -c SHA256SUMS --ignore-missing` (`shasum -a 256 -c` on macOS) and `gh attestation verify`. They also say the Windows and darwin-x64 binaries were not tested end to end. The same steps are in the [README](../../README.md#verify-a-release). The Registry's own integrity hashes (recorded per Module in the Lockfile) are separate: they cover Modules, not the CLI.

## Release tooling

Two options were compared for versioning, changelog and tagging.

|                                        | changesets                                                                                                               | bumpp + changelogithub                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Model                                  | A markdown "changeset" file per change, committed with the PR; a bot opens a "Version Packages" PR that aggregates them. | The maintainer runs `bumpp` to bump the version, tag and push; `changelogithub` generates GitHub release notes from conventional commits. |
| Fit for monorepo with several packages | Built for it: per-package versions, dependency bumps, linked and fixed groups.                                           | Single version; fine for one version across packages, no per-package logic.                                                               |
| Source of release notes                | Hand-written changeset text.                                                                                             | Commit messages, which in this repo are already gitmoji + conventional commits with bullet bodies.                                        |
| Extra process                          | Contributors must add a changeset; a release PR must be merged.                                                          | None per change; one command per release.                                                                                                 |
| npm trusted publishing                 | Works; publish step in CI after the release PR merges.                                                                   | Works; publish step runs on the pushed tag.                                                                                               |
| Maintenance                            | More moving parts (action, bot PR, config).                                                                              | Two small tools.                                                                                                                          |

**Decision: bumpp + changelogithub.** aokit has two packages released together at one version (`aokit` and `create-aokit`), a single maintainer, and commit messages that already follow a strict convention, so generated notes cost nothing and a per-change changeset file would be duplicated effort. The release flow is: `bumpp` creates the version commit and tag, the tag triggers the [release workflow](#release-workflow), which builds, tests, builds the binaries, generates `SHA256SUMS` and attestations, fills the GitHub Release with `changelogithub` notes and publishes to npm with provenance. Revisit changesets only if the repository grows packages that must version independently.

A Registry Release is not published by the workflow: its Catalog and Module manifests are committed under `registry/` at the Release cut ([ADR 0024](../adr/0024-pending-modules-catalog-fragments-and-release-cuts.md)) and travel inside the `aokit` tarball and the binaries, so a CLI version and the Releases it supports stay traceable through `minCliVersion`. Release names are dated (`2026.12.1`) and package versions are semver ([ADR 0026](../adr/0026-registry-releases-are-dated-cli-versions-are-semver.md)).

## Telemetry

None in v1. The CLI, the MCP server and generated Projects send no usage data, crash reports or identifiers, and the only network calls are the ones the user asked for: Registry fetches, the npm update check ([CLI UX](cli-ux.md#version-and-update-notices)) and dependency installation. If telemetry is ever added, it will be opt-in, off by default, documented here first, and will honor `DO_NOT_TRACK=1` and `AOKIT_NO_TELEMETRY=1` regardless of any other setting.

## CI: determinism on Linux and macOS

Generation must be byte-identical across machines ([Engine: determinism](engine.md#determinism)). CI enforces it:

1. For each Project in the curated set, run `create` twice into separate directories with identical inputs and `now`, `random` and `env` injected.
2. Hash every emitted file, excluding values marked volatile, and hash the sorted list of `path` and file hashes into one digest per Project.
3. Fail if the two digests differ, and diff the trees to show why.
4. Run the same job on a Linux runner and a macOS runner and fail if the digests differ **across** operating systems (this catches path separators, line endings, locale-dependent sorting and file-mode differences).
5. Run it for both the npm build and the compiled binary, and fail if their digests differ. Both embed the same native parser, so a difference points at bundling, asset embedding or the extraction path.

The matrix stores no snapshots. The digests of the curated real-build sets are compared to a committed baseline (`packages/aokit/test/matrix/curated-digests.txt`), so an unintended change in generated output fails `bun run test`; an intended one regenerates the file on purpose.

## CI runners

Linux jobs run on Blacksmith runners, following the andryorelabs CI runner standard v1.1. The routing is temporary while the repository is private.

The standard uses one plain repository variable, `BLACKSMITH_RUNNER` (value `blacksmith-2vcpu-ubuntu-2404`, an x64 runner), and no secrets and no Blacksmith actions. A routed job uses:

```yaml
runs-on: ${{ github.event.pull_request.head.repo.fork && 'ubuntu-latest' || vars.BLACKSMITH_RUNNER || 'ubuntu-latest' }}
```

A job with an `os` matrix uses the matrix form, so only the Linux leg is routed:

```yaml
runs-on: ${{ matrix.os == 'ubuntu-latest' && (github.event.pull_request.head.repo.fork && 'ubuntu-latest' || vars.BLACKSMITH_RUNNER || 'ubuntu-latest') || matrix.os }}
```

A pull request from a fork, or a repository without the variable, falls back to `ubuntu-latest`. The standard routes only light jobs in public repositories, where the variable is left unset. The private-repo amendment routes every Linux job.

Routed jobs:

| Workflow           | Job                  | Form   |
| ------------------ | -------------------- | ------ |
| `ci.yml`           | `check`              | plain  |
| `ci.yml`           | `test` (Linux leg)   | matrix |
| `ci.yml`           | `commitlint`         | plain  |
| `determinism.yml`  | `digest` (Linux leg) | matrix |
| `determinism.yml`  | `compare`            | plain  |
| `distribution.yml` | `linux-x64`          | plain  |
| `docker.yml`       | `smoke`              | plain  |
| `real-build.yml`   | `build`              | plain  |
| `upgrade.yml`      | `upgrade`            | plain  |

Never routed: the macOS legs of `ci.yml` and `determinism.yml`, and any Windows, release, deploy, CodeQL, Scorecard or Lighthouse job. No VPS or self-hosted runners. `tools/workflows/runner-routing.test.ts` holds the `routedJobs` list and fails when a listed job lacks the expression, an unlisted job uses anything but a literal `ubuntu-latest` or `macos-*` label, a label matches `vps-*` or `self-hosted`, or `vars.BLACKSMITH_RUNNER` appears outside these expressions.

macOS stays on GitHub-hosted runners: Blacksmith macOS costs $0.08/min, 20x its Linux rate, and the macOS legs exist to catch OS differences, not to run fast.

Baseline on GitHub-hosted `ubuntu-latest` (the `main` runs on `b370cb1`, job durations):

| Job                                | Duration     |
| ---------------------------------- | ------------ |
| `check and test (ubuntu-latest)`   | 38 s         |
| `digest (ubuntu-latest)`           | 12 s         |
| `compare digests`                  | 6 s          |
| `package and binary (linux-x64)`   | 49 s         |
| `smoke` (per Layout)               | 16 s to 25 s |
| `build` (per Layout and selection) | 9 s to 11 s  |
| `upgrade`                          | 11 s         |

Enable routing:

```sh
gh variable set BLACKSMITH_RUNNER --body blacksmith-2vcpu-ubuntu-2404
```

Roll back to GitHub-hosted runners, with no workflow change:

```sh
gh variable delete BLACKSMITH_RUNNER
```

When aokit goes public, run `gh variable delete BLACKSMITH_RUNNER` and narrow the routing to the light jobs: `ci.yml` `check`, `test` (Linux leg) and `commitlint` and `determinism.yml` `compare`. The other workflows go back to a literal `ubuntu-latest`, and `routedJobs` is updated to match.
