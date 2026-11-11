# Renovate

The `renovate` Module ships this policy. It implements the default dependency policy: ranges plus a lockfile, with exact pins only for Toolchain pin groups. Related: [typescript](typescript.md), [tooling](tooling.md), index in [standards](README.md).

The policy is implemented in [`renovate.json5`](../../renovate.json5) and checked by `tools/renovate/renovate-config.test.ts`. Versions in workflows are bumped through `# renovate: datasource=<ds> depName=<name>` comments placed on the line above a `VERSION: x.y.z` entry. The comment form only exists in YAML, so tool pins that live in TypeScript under `tools/` (for example the lychee version in `tools/lint-docs/args.ts`, which carries a sha256 table) are bumped by hand together with their checksums. That is an open gap against rule F5 below, which asks for every tool pin to be Renovate-managed.

## Defaults

| Setting             | Value                                                | Reason                                                                                                    |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `rangeStrategy`     | `bump`                                               | Ranges in `package.json` move with the lockfile, so the declared range always reflects what is installed. |
| `minimumReleaseAge` | `3 days` by default; `7 days` for automerged updates | Gives the registry time to yank bad or compromised releases before they land.                             |
| Lockfile            | Bun lockfile committed                               | Reproducible installs; Renovate updates both.                                                             |
| Schedule            | Monday                                               | One predictable batch of updates per week.                                                                |

All active reference repositories already use `bump` with a release age and automerge; none pins every dependency.

## Rules

- **F5** (must) Renovate follows the best-practices preset with `bump`, a 3-day release age (7 days for automerge), a Monday schedule and the dependency dashboard; the labels it applies exist in `labels.yml`, pin groups are never automerged, a test covers the config, and tool pins are Renovate-managed. Reason: updates arrive in one reviewable batch and the toolchain moves only by hand.

## Automerge

- Automerge is allowed for patch and minor updates of non-toolchain dependencies, after CI passes and the release age has elapsed.
- Major updates are never automerged.
- Dev-only type packages and lint plugins may be grouped to cut noise.

## Exact-pin groups

Toolchain pin groups are pinned exactly (`rangeStrategy: "pin"`), each in its own group so the members move in one pull request:

| Group         | Members                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `oxc`         | `oxlint`, `oxfmt`, the Oxlint type-aware backend, related oxc packages |
| `typescript7` | the `typescript7` alias (`typescript@7.1.0-beta`)                      |

The real `typescript` 6.x dependency follows the normal range policy unless the Project's Catalog pins it.

## No automerge for the toolchain

Pin groups are **never automerged**. A bump of Oxc or `typescript7` can change which violations are reported or which types are accepted, so it needs a human to read the result and, for Oxc, re-run the [parity gate](tooling.md#differential-parity-gate).

## Bun catalogs

Renovate does not support Bun catalogs yet (upstream pull request 42909 is open). In a `monorepo` Project the Catalog is therefore handled differently:

- A registry's catalog lives in `catalog/<release>.json` and is updated with a `jsonata` `customManager`.
- Generated Projects use Bun catalogs and the bare `catalog:` specifier, never `catalog:default`.
- Until native support lands, Renovate in a Project updates `package.json` ranges directly and the registry updates its own Catalog on release.

## CI around Renovate

The registry's CI matrix builds capability-derived pairwise combinations across Layouts, plus an upgrade job from release N-1 to N that must finish with zero conflicts.
