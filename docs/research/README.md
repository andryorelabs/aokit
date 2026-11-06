# Research

Sourced findings behind aokit's design. This folder says what is true and where it came from; the architecture docs ([`docs/architecture/`](../architecture/overview.md)) say what aokit does about it. Terms follow [GLOSSARY.md](../../GLOSSARY.md).

| Doc                                                    | Summary                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [scaffolding-landscape.md](scaffolding-landscape.md)   | How create-t3-app and Better-T-Stack work, and where each breaks down as options grow                                                         |
| [engine-and-registry.md](engine-and-registry.md)       | Code and file editing libraries, Nx/Angular tree patterns, shadcn registry schema, determinism sources, templating without an engine          |
| [lifecycle-and-versions.md](lifecycle-and-versions.md) | Copier, cruft, Projen, nx migrate and ng update; 3-way merge options; `remove` precedents; Bun/pnpm catalogs; Renovate gaps; lockfile designs |
| [cli-and-tooling.md](cli-and-tooling.md)               | CLI frameworks, clack caveats, Zod v4 JSON Schema, Bun compile limits, MCP, agent files, publishing, telemetry                                |
| [reference-repos-audit.md](reference-repos-audit.md)   | What Andry's current reference repos use today, and the cross-repo consensus corrections                                                      |
| [raw-notes.md](raw-notes.md)                           | Unedited seed research and decision history; superseded where it conflicts with the Specs                                                     |

Conventions: claims cite a URL or a repo path (`raw-notes.md L<n>` for the planning-session research). Confidence is marked where the notes mark it; details the notes do not contain are flagged as unverified rather than filled in.
