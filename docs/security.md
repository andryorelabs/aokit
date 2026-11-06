# Security model

What aokit protects, what it trusts and where its protection ends. This page is the threat model; the protocol it relies on is specified in [Registry protocol and trust model](architecture/registry.md). To report a vulnerability, follow [SECURITY.md](../.github/SECURITY.md). Terms follow [GLOSSARY.md](../GLOSSARY.md).

## Assets and actors

- **Assets:** the files of a Project, the machine that runs `aokit`, and the user's secrets in the environment.
- **Trusted:** the first-party Registry shipped with the CLI and any Registry given as a local directory (it is code the user already has).
- **Untrusted until allowed:** every remote Registry (`https://` or `github:owner/repo#ref`) and every shadcn Registry.
- **Out of the model:** an attacker who already controls the user's machine, the npm package of the CLI itself, or the user's Git hosting.

## Registry integrity

A Registry serves Module manifests and files. Integrity checks make sure what arrives is what the index promised.

- Each Module version has one `sha256-<hex>` integrity over its canonical manifest and files. The client recomputes it and rejects a mismatch before anything enters the VFS (`REGISTRY_INTEGRITY_MISMATCH`, exit `1`).
- The Lockfile copies the integrity verbatim and every later `add`, `remove`, `recopy`, `update` and `create --from` re-verifies against it. A Registry that changes a published version is detected.
- `github:` sources are resolved once to a 40-hex commit SHA and recorded as that SHA. Only `update --registry github:owner/repo#<ref>` moves the Pin, and the Plan shows the new SHA.
- An index entry whose file path is absolute or escapes the Module directory is rejected before any fetch or cache write.
- shadcn items have no published integrity, so aokit records one on first use; a later change fails with `REGISTRY_ITEM_CHANGED`.

Integrity detects change and corruption. It does not make a malicious Registry harmless, which is the job of the trust gate.

## The trust gate

Before a command fetches from a Registry that is not first-party or local, the trust gate decides whether it may.

- A Registry is allowed by the user config allowlist (`trustedRegistries`), by `--trust <name|source>` on the command, or by `registries.<name>.trusted: true` in the Project's Lockfile.
- Otherwise an interactive run asks once, naming the Registry, its pinned SHA and what trusting it enables. The prompt appears again when the source changes.
- `--yes` never grants trust. With no TTY, with `--yes` or under a coding agent (`CI`, `CLAUDECODE`, `CURSOR_AGENT`, `CODEX_SANDBOX`, `GEMINI_CLI` or `AOKIT_AGENT`), an untrusted Registry fails with `REGISTRY_UNTRUSTED` (exit `5`) and the error shows the exact `--trust` form. Nothing beyond the index is fetched.
- A Lockfile fetched with `create --from <url>` never carries trust: its `trusted` flags are not the user's decision.
- Trust is recorded per user (config) and per Project (Lockfile), never globally by a flag.

## Hostile Modules

A Module from a trusted Registry can change the Project. A Module from an untrusted one is limited.

| Capability                                            | Untrusted Registry                  | Trusted Registry |
| ----------------------------------------------------- | ----------------------------------- | ---------------- |
| Declarative `files`, `deps`, `env` and `ops`          | After the trust prompt or allowlist | Allowed          |
| Arbitrary transform code                              | Refused, naming the Module          | Allowed          |
| Remote lifecycle or install scripts                   | Blocked                             | Blocked          |
| Installing or fetching during the deterministic phase | Never allowed                       | Never allowed    |

shadcn-adapted items are declarative only: the adapter maps them to files, dependencies, env entries and a small set of Ops, and they can never carry a transform. A hostile declarative Module can still add files and dependencies you did not expect. Review the Plan with `--dry-run` or `--diff` before applying; for an untrusted source the Plan names the Registry, the pinned SHA and the integrity.

## Generated output

aokit writes into the user's Project, so the output is part of the attack surface.

- Every write is planned in a VFS first and applied atomically; an interrupted run leaves the Project unchanged.
- Registry-supplied file paths that are absolute or escape the Module directory are rejected before any write.
- Generation is deterministic and runs nothing that fetches or installs. `bun install` runs after the apply, and `--no-install` skips it.
- The Lockfile records a hash per file, so `doctor` reports Drift on files changed after generation, and `diff` shows how they differ from their Render.
- The CLI sends no telemetry ([ADR 0013](adr/0013-no-telemetry-in-v1.md)). The update notice contacts only the npm registry and can be disabled with `AOKIT_NO_UPDATE_NOTIFIER=1`.

## Known limits

- A trusted Registry can run arbitrary transform code with your user permissions. Trust only Registries you would run a script from.
- Trusting a Registry covers every Module it serves, including versions published later; the per-Module integrity in the Lockfile only guards versions you already recorded.
- Mutable `https://` sources are not content-pinned as a whole. The pin is the per-Module integrity in the Lockfile.
- The dependencies a Module installs come from npm and are outside aokit's integrity checks; the Lockfile of the package manager governs them.
- aokit does not sandbox the editor, the package manager or the tools a generated Project runs.
- Only the latest release is supported with security fixes.
