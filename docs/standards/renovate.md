# Renovate

The `renovate` Module ships this policy. It implements the default dependency policy: ranges plus a lockfile, with exact pins only for Toolchain pin groups. Related: [typescript](typescript.md), [tooling](tooling.md), index in [standards](README.md).

The policy is implemented in [`renovate.json5`](../../renovate.json5) and checked by `tools/renovate/renovate-config.test.ts`. Versions in workflows are bumped through `# renovate: datasource=<ds> depName=<name>` comments placed on the line above a `VERSION: x.y.z` entry.

## Defaults

| Setting             | Value                                                     | Reason                                                                                                    |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `rangeStrategy`     | `bump`                                                    | Ranges in `package.json` move with the lockfile, so the declared range always reflects what is installed. |
| `minimumReleaseAge` | `3 days` by default; `7 days` for groups that break often | Gives the registry time to yank bad or compromised releases before they land.                             |
| Lockfile            | Bun lockfile committed                                    | Reproducible installs; Renovate updates both.                                                             |
| Schedule            | Per repo                                                  | Not part of the standard.                                                                                 |

All active reference repositories already use `bump` with a release age and automerge; none pins every dependency.

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
