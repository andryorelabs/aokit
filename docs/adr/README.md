# Architecture decision records

Decisions that are hard to reverse, surprising without context, and the result of a real trade-off. The ADRs summarize decisions already fixed by the [architecture docs](../architecture/overview.md), the [standards](../standards/README.md) and the [research](../research/README.md); the architecture doc named in each ADR holds the detail. Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## Index

| # | Title | Status | Spec |
| --- | --- | --- | --- |
| 0001 | [Capabilities instead of fixed categories](0001-capabilities-instead-of-fixed-categories.md) | Accepted | S5, S2 |
| 0002 | [Modules integrate through versioned extension points and declarative ops (no inverse ops)](0002-extension-points-and-declarative-ops.md) | Accepted | S2, S3, S5 |
| 0003 | [`remove` re-renders without the module and 3-way merges](0003-remove-by-rerender-and-three-way-merge.md) | Accepted | S6, S7 |
| 0004 | [Own registry protocol with a shadcn adapter and integrity hashes](0004-own-registry-protocol-with-shadcn-adapter.md) | Accepted | S12, S7 |
| 0005 | [Layout is optional and logical targets decouple modules from paths](0005-optional-layout-and-logical-targets.md) | Accepted | S4 |
| 0006 | [Bun-only](0006-bun-only.md) | Accepted | S11, S8 |
| 0007 | [Ranges + lockfile by default with toolchain pin groups](0007-ranges-and-lockfile-with-toolchain-pin-groups.md) | Accepted | S8 |
| 0008 | [Oxc as default tooling with a full-rule ESLint companion](0008-oxc-default-with-eslint-companion.md) | Accepted | S14 |
| 0009 | [One Zod schema drives CLI, prompts and MCP, with trpc-cli behind an own command layer](0009-one-zod-schema-for-all-interfaces.md) | Accepted | S10, S9 |
| 0010 | [Locate-and-splice edit engine, magicast only for config objects](0010-locate-and-splice-edit-engine.md) | Accepted | S3 |
| 0011 | [File ownership modes and per-file hashes](0011-file-ownership-modes-and-per-file-hashes.md) | Accepted | S7 |
| 0012 | [Deterministic generation and atomic writes](0012-deterministic-generation-and-atomic-writes.md) | Accepted | S3 |
| 0013 | [No telemetry in v1](0013-no-telemetry-in-v1.md) | Accepted | S11 |
| 0014 | [Extension point anchors are identifier names](0014-extension-point-anchors-are-identifier-names.md) | Accepted | S12 (core spec) |
| 0015 | [Lifecycle outcomes are error codes with data](0015-lifecycle-outcomes-are-error-codes-with-data.md) | Accepted | S3 (phase 4a spec) |
| 0016 | [Update moves a Project between Releases](0016-update-moves-a-project-between-releases.md) | Accepted | S6, S7 (phase 4b spec) |
| 0017 | [Remote Registries serve the local layout, trust is recorded per user and per Project](0017-remote-registries-over-the-local-layout.md) | Accepted | S6 to S13 (phase 5a spec) |
| 0018 | [shadcn items become declarative Adapted Modules with a synthetic version and a mandatory cache](0018-shadcn-items-are-adapted-modules.md) | Accepted | S1 to S15 (phase 5b spec) |

## Format

One file per decision, named `NNNN-kebab-title.md`, numbered in order and never renumbered. Every ADR has:

- A header: `Status:` (with date), `Spec:` (the S# of AO-2673 it comes from) and `Architecture:` (the doc, with anchors, that details it).
- **Context**: the forces and why the question is hard.
- **Decision**: what is decided, in the present tense.
- **Consequences**: what becomes easier, harder or fixed.
- **Alternatives considered**: what was rejected and why.

ADRs are living, as in [docs and forge](../standards/docs-and-forge.md#living-adrs). A decision that changes is revised in place and gains a `Revised:` line under `Status:` with the date and a one-line reason. The original text is not deleted, and a reversed decision says so in its Decision section. The index must list every ADR file, and every listed file must exist.
