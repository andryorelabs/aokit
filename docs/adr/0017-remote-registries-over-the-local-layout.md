# 0017. Remote Registries serve the local layout, trust is recorded per user and per Project

Status: Accepted (2026-11-04)
Spec: S6 to S13 (Spec: Phase 5a, Registry client)
Architecture: [Registry: kinds](../architecture/registry.md#registry-kinds), [Registry: trust model](../architecture/registry.md#trust-model)

## Context

Until phase 5a a Registry is a directory: the bundled one or a local path. Remote Registries must be readable from a URL or a git host, verified, and kept from running untrusted content by default. The CLI already depends on a fixed set of packages, runs on Bun, and is used by coding agents that cannot answer prompts.

## Decision

A remote Registry serves exactly the layout of a local one (`index.json`, `catalog/<release>.json`, `modules/<name>/<version>/...`) over HTTP, read with native `fetch`. The client reads lazily: the index and current Catalog first, then only the Module versions a command needs, each verified against its integrity. A `github:owner/repo#ref` source resolves `ref` to a full commit SHA with `git ls-remote` and reads files from that SHA; the Lockfile records the Pin, and only `update --registry` moves it. A URL source is not pinned by a hash of its index, because the index grows with every version; the per-Module integrity in the Lockfile is the pin. There is no giget dependency.

Trust is a per-user and per-Project fact. The user config allowlist (`trustedRegistries`) and `--trust` allow a Registry non-interactively; a Registry the user trusted is recorded as `trusted` in the Project's Lockfile, so a clone does not ask again unless the host or repository changes. `--yes` never grants trust, and a run with no TTY, with `--yes` or inside a detected coding agent fails with `REGISTRY_UNTRUSTED` and the exact `--trust` form.

## Consequences

- A Registry can be hosted as static files anywhere, including a git host, with no server logic.
- A command touches the network only for the Modules it needs; a warm cache serves read-only commands offline.
- The Lockfile gains one optional field, so Lockfile v2 stays valid and no migration is needed.
- Tests need no network: a local HTTP server and injected git and GitHub adapters stand in for the real ones.
- A branch ref on a git host cannot silently change what an existing Project fetches.

## Alternatives considered

- **giget for git sources**: rejected. It adds a dependency and a tarball download for what two small reads do, and it hides the SHA the Lockfile must record.
- **Hash the index of a URL source as its pin**: rejected. The index is append-only, so the hash would change on every release and trust would be re-asked constantly.
- **Trust recorded only in the user config**: rejected. A fresh clone or CI run would fail or prompt for a Registry the team already accepted.
- **Let `--yes` grant trust**: rejected. It would make the safety prompt a flag away from useless for agents.
