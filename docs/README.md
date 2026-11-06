# Documentation index

Every Markdown file under `docs/` has a row here; a test fails when one is missing. Terms follow [GLOSSARY.md](../GLOSSARY.md).

## Overview

| Doc                      | Title   |
| ------------------------ | ------- |
| [roadmap.md](roadmap.md) | Roadmap |

## Reference

| Doc                                      | Title           |
| ---------------------------------------- | --------------- |
| [reference/cli.md](reference/cli.md)     | CLI reference   |
| [security.md](security.md)               | Security model  |
| [troubleshooting.md](troubleshooting.md) | Troubleshooting |

## Architecture

| Doc                                                                | Title                             |
| ------------------------------------------------------------------ | --------------------------------- |
| [architecture/capabilities.md](architecture/capabilities.md)       | Capabilities                      |
| [architecture/cli-ux.md](architecture/cli-ux.md)                   | CLI UX                            |
| [architecture/distribution.md](architecture/distribution.md)       | Distribution                      |
| [architecture/engine.md](architecture/engine.md)                   | Engine                            |
| [architecture/interfaces.md](architecture/interfaces.md)           | Interfaces                        |
| [architecture/layouts.md](architecture/layouts.md)                 | Layouts                           |
| [architecture/lifecycle.md](architecture/lifecycle.md)             | Lifecycle                         |
| [architecture/lockfile.md](architecture/lockfile.md)               | Lockfile and state                |
| [architecture/module-catalog.md](architecture/module-catalog.md)   | Module catalog                    |
| [architecture/module-contract.md](architecture/module-contract.md) | Module contract                   |
| [architecture/overview.md](architecture/overview.md)               | Architecture overview             |
| [architecture/registry.md](architecture/registry.md)               | Registry protocol and trust model |
| [architecture/versions.md](architecture/versions.md)               | Dependency versions               |

## Architecture decision records

| Doc                                                                                                                                      | Title                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [adr/README.md](adr/README.md)                                                                                                           | Architecture decision records                                                                         |
| [adr/0001-capabilities-instead-of-fixed-categories.md](adr/0001-capabilities-instead-of-fixed-categories.md)                             | 0001. Capabilities instead of fixed categories                                                        |
| [adr/0002-extension-points-and-declarative-ops.md](adr/0002-extension-points-and-declarative-ops.md)                                     | 0002. Modules integrate through versioned extension points and declarative ops (no inverse ops)       |
| [adr/0003-remove-by-rerender-and-three-way-merge.md](adr/0003-remove-by-rerender-and-three-way-merge.md)                                 | 0003. `remove` re-renders without the module and 3-way merges                                         |
| [adr/0004-own-registry-protocol-with-shadcn-adapter.md](adr/0004-own-registry-protocol-with-shadcn-adapter.md)                           | 0004. Own registry protocol with a shadcn adapter and integrity hashes                                |
| [adr/0005-optional-layout-and-logical-targets.md](adr/0005-optional-layout-and-logical-targets.md)                                       | 0005. Layout is optional and logical targets decouple modules from paths                              |
| [adr/0006-bun-only.md](adr/0006-bun-only.md)                                                                                             | 0006. Bun-only                                                                                        |
| [adr/0007-ranges-and-lockfile-with-toolchain-pin-groups.md](adr/0007-ranges-and-lockfile-with-toolchain-pin-groups.md)                   | 0007. Ranges + lockfile by default with toolchain pin groups                                          |
| [adr/0008-oxc-default-with-eslint-companion.md](adr/0008-oxc-default-with-eslint-companion.md)                                           | 0008. Oxc as default tooling with a full-rule ESLint companion                                        |
| [adr/0009-one-zod-schema-for-all-interfaces.md](adr/0009-one-zod-schema-for-all-interfaces.md)                                           | 0009. One Zod schema drives CLI, prompts and MCP, with trpc-cli behind an own command layer           |
| [adr/0010-locate-and-splice-edit-engine.md](adr/0010-locate-and-splice-edit-engine.md)                                                   | 0010. Locate-and-splice edit engine, magicast only for config objects                                 |
| [adr/0011-file-ownership-modes-and-per-file-hashes.md](adr/0011-file-ownership-modes-and-per-file-hashes.md)                             | 0011. File ownership modes and per-file hashes                                                        |
| [adr/0012-deterministic-generation-and-atomic-writes.md](adr/0012-deterministic-generation-and-atomic-writes.md)                         | 0012. Deterministic generation and atomic writes                                                      |
| [adr/0013-no-telemetry-in-v1.md](adr/0013-no-telemetry-in-v1.md)                                                                         | 0013. No telemetry in v1                                                                              |
| [adr/0014-extension-point-anchors-are-identifier-names.md](adr/0014-extension-point-anchors-are-identifier-names.md)                     | 0014. Extension point anchors are identifier names                                                    |
| [adr/0015-lifecycle-outcomes-are-error-codes-with-data.md](adr/0015-lifecycle-outcomes-are-error-codes-with-data.md)                     | 0015. Lifecycle outcomes are error codes with data                                                    |
| [adr/0016-update-moves-a-project-between-releases.md](adr/0016-update-moves-a-project-between-releases.md)                               | 0016. Update moves a Project between Releases                                                         |
| [adr/0017-remote-registries-over-the-local-layout.md](adr/0017-remote-registries-over-the-local-layout.md)                               | 0017. Remote Registries serve the local layout, trust is recorded per user and per Project            |
| [adr/0018-shadcn-items-are-adapted-modules.md](adr/0018-shadcn-items-are-adapted-modules.md)                                             | 0018. shadcn items become declarative Adapted Modules with a synthetic version and a mandatory cache  |
| [adr/0019-mcp-tools-take-an-explicit-schema-and-session-plan-ids.md](adr/0019-mcp-tools-take-an-explicit-schema-and-session-plan-ids.md) | 0019. MCP tools take an explicit variant of the command schema and session-scoped plan ids            |
| [adr/0020-agent-files-are-region-files-merged-by-region.md](adr/0020-agent-files-are-region-files-merged-by-region.md)                   | 0020. Agent files are Region files, merged by Region and owned in part by aokit                       |
| [adr/0021-layout-migration-pairs-files-by-provenance.md](adr/0021-layout-migration-pairs-files-by-provenance.md)                         | 0021. Layout migration pairs files by Provenance and moves seed files as they are                     |
| [adr/0022-repo-lint-config-is-typescript.md](adr/0022-repo-lint-config-is-typescript.md)                                                 | 0022. The aokit repo configures Oxlint and Knip in TypeScript and JSONC, generated Projects keep JSON |

## Standards

| Doc                                                        | Title          |
| ---------------------------------------------------------- | -------------- |
| [standards/README.md](standards/README.md)                 | Standards      |
| [standards/docs-and-forge.md](standards/docs-and-forge.md) | Docs and forge |
| [standards/renovate.md](standards/renovate.md)             | Renovate       |
| [standards/tooling.md](standards/tooling.md)               | Tooling        |
| [standards/typescript.md](standards/typescript.md)         | TypeScript     |

## Research

| Doc                                                                      | Title                                       |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| [research/README.md](research/README.md)                                 | Research                                    |
| [research/cli-and-tooling.md](research/cli-and-tooling.md)               | CLI and tooling findings                    |
| [research/engine-and-registry.md](research/engine-and-registry.md)       | Engine and registry findings                |
| [research/lifecycle-and-versions.md](research/lifecycle-and-versions.md) | Lifecycle and version findings              |
| [research/raw-notes.md](research/raw-notes.md)                           | Raw research notes (seed for docs/research) |
| [research/reference-repos-audit.md](research/reference-repos-audit.md)   | Reference repos audit                       |
| [research/scaffolding-landscape.md](research/scaffolding-landscape.md)   | Scaffolding landscape                       |

## Agent docs

| Doc                                                | Title                                               |
| -------------------------------------------------- | --------------------------------------------------- |
| [agents/codebase.md](agents/codebase.md)           | Codebase map                                        |
| [agents/domain.md](agents/domain.md)               | Domain docs                                         |
| [agents/emet.md](agents/emet.md)                   | `/forge` operational specifics for andryore-starter |
| [agents/issue-tracker.md](agents/issue-tracker.md) | Issue tracker: Linear                               |
| [agents/triage-labels.md](agents/triage-labels.md) | Triage labels                                       |
