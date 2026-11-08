# Dependency versions

How generated Projects pin their dependencies, how the Catalog is maintained, and how CI proves a Registry release is safe to update to. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Related: [Module contract](module-contract.md#deps), [Lockfile](lockfile.md), [lifecycle](lifecycle.md), [Layouts](layouts.md), [Capabilities](capabilities.md).

## Policy

**Default: ranges plus a lockfile.** Dependencies are written to `package.json` as semver ranges (`^16.0.0`). Reproducibility comes from the Bun lockfile (`bun.lock`), not from pinning every version. Renovate keeps ranges current with `rangeStrategy: "bump"` (the range is raised to the new version, not left as-is) and a `minimumReleaseAge` (three days by default, longer for selected groups) so a freshly published release is not adopted before it has been out for a while. aokit ships this as the `renovate` Module.

Why not pin everything: every active reference repository uses ranges with `bump` and `minimumReleaseAge` and pins only toolchain packages. Pinning all dependencies makes each Renovate PR a noisy exact-version change, and it is not what the Projects aokit generates for already do.

Exceptions, in this order of precedence:

1. [Toolchain pin groups](#toolchain-pin-groups): pinned exactly, always.
2. [`aokit deps pin`](#aokit-deps-pin): pinned exactly because the user asked.
3. Everything else: a range from the [Catalog](#catalogs).

The Lockfile records the outcome per dependency in `deps.<name>` as `{version, pinned, source}` ([Lockfile](lockfile.md#field-table)), so `update` knows which versions are the user's choice.

## Toolchain pin groups

A Toolchain pin group is a set of dependencies pinned exactly regardless of the default. A Module marks a dependency with `pinGroup` ([Module contract](module-contract.md#deps)); every Module listing the same group name moves together, because the packages in a group must be tested as one version set.

| Group         | Members                                                                                                            | Why                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oxc`         | `oxlint`, `oxfmt`, `oxlint-tsgolint`, and the other Oxc packages                                                   | Rule behavior and formatter output change between versions. The format phase is part of [deterministic generation](engine.md#determinism), so a floating formatter would make the same inputs produce different bytes. |
| `typescript7` | `typescript` as the real 6.x release from the Catalog, plus an exact alias `typescript7` to the 7.x native release | Both compilers must coexist while 7.x has no JS API.                                                                                                                                                                   |

Rules for the TypeScript group:

- `typescript` resolves to a 6.x release (a range from the Catalog) so tools that need the JS API (typescript-eslint, optional ts-morph, see [Engine](engine.md#code-edits-locate-and-splice)) keep working.
- `typescript7` is an npm alias to the TypeScript 7 release, pinned exactly (for example `"typescript7": "npm:typescript@7.1.0-beta"`).
- Scripts call the alias with an **explicit bin path** (`bun x --bun ./node_modules/typescript7/bin/tsc`, not a bare `tsc`), because `node_modules/.bin/tsc` may resolve to 6.x.
- The module ships a **version test** that runs the alias with `--version` and fails unless it reports 7.x, so a wrong resolution is caught in CI and by `doctor`, not by a confusing type error.

Pinned dependencies have `pinned: true` in the Lockfile, and Renovate groups them: one PR per group, no automerge, exact `rangeStrategy: "pin"`.

## `aokit deps pin`

`aokit deps pin [pkg]` is the opt-in for a Project that wants exact versions.

- With `pkg`: pins that dependency at its currently resolved version, sets `pinned: true` and `source: "user"` in the Lockfile.
- Without `pkg`: pins every dependency aokit manages.
- `aokit deps unpin [pkg]` reverses it, returning the dependency to the Catalog's range.
- `update` respects the state: a pinned dependency keeps its version unless the new Catalog moves a Toolchain pin group it belongs to; for a user-pinned dependency outside a group, `update` reports a newer Catalog version and does not change it.
- The command is a Plan like any other, with `--dry-run` and `--diff`, and changes `package.json` and the Lockfile only.

## Catalogs

A Catalog is the set of dependency versions a Registry release ships, tested together. A Module's `deps` entry with `range: "catalog"` takes its version from it.

For the first-party Registry, each release has a file `catalog/<release>.json`:

```json
{
  "release": "2026.11.0",
  "dependencies": {
    "next": "^16.0.0",
    "oxlint": "1.90.0"
  },
  "pinGroups": {
    "oxc": ["oxlint"]
  }
}
```

Dependencies listed in a `pinGroups` entry hold exact versions; the others hold ranges. The Resolver reads the Catalog of the release recorded in the Lockfile, so a Project's resolved dependency versions come from the release it was generated against and change only through `update`.

### Bun catalogs for the monorepo

In the `monorepo` [Layout](layouts.md#resolution-tables), the root `package.json` holds a Bun `catalog` and workspace packages reference it. Two rules:

- **Emit bare `catalog:`**, never `catalog:default`. Bun resolves both, but `catalog:default` has behaved inconsistently across Bun versions and tools; the bare form is the documented one.
- In the `single` Layout there is no catalog and dependencies carry their ranges directly. The Module does not know the difference: the Layout produces the form ([Layouts](layouts.md#resolution-tables)).

Only Bun catalogs exist. There is no pnpm catalog and no package-manager abstraction: aokit and the Projects it generates are Bun-only.

### Renovate and the Registry catalog

Renovate does not support Bun catalogs (the upstream pull request, #42909, is open). It therefore cannot update `catalog` entries in `package.json` for a Project directly, and it also does not know about `catalog/<release>.json`. For the Registry's own repository:

- Catalogs live as `catalog/<release>.json`.
- A Renovate `customManager` of type `jsonata` extracts each dependency and range from those files and proposes updates, with `rangeStrategy: "pin"` for entries with a `pinGroup` and `bump` for the rest, `minimumReleaseAge` on both, and one group per pin group.
- A merged Renovate PR changes the catalog for the **next** release; a released catalog file is immutable, like a Module version ([Lockfile](lockfile.md#old-module-versions-stay-fetchable)).
- In a generated Project, the shipped `renovate` Module uses Renovate's native `package.json` support for `single` and for workspace packages' direct dependencies. Catalog-level updates in a `monorepo` Project are produced by `aokit update` as a Plan against the new release, until Renovate gains Bun catalog support; then the Module's config can drop the workaround.

## CI

Two jobs protect each Registry release. Both are generated from the declarations in the manifests, not from a hand-written list.

**Matrix.** The set of Module combinations is derived from Capabilities: selections are built constructively, a pairwise (all-pairs) cover grown through `requires` closures with O(n^2) Resolver calls rather than by enumerating every subset, so the matrix stays fast with dozens of Modules and a Module whose `requires` cannot be satisfied is skipped, never a hang. The cover is crossed with both Layouts (`single`, `monorepo`). Each combination is generated twice and the hashes compared ([determinism](engine.md#determinism)); a curated subset also runs a real install, build and typecheck. The committed digest snapshot is gone; build-twice equality remains. The curated real-build set is read from `tools/real-build/curated/*.json` by a plan job, so a new curated file adds a job with no workflow edit. Pending Modules resolve against the draft Catalog ([ADR 0024](../adr/0024-pending-modules-catalog-fragments-and-release-cuts.md)). A new Module joins the matrix by declaring itself ([Capabilities](capabilities.md#deriving-compatibility)).

**Upgrade job.** For each curated combination, generate a Project with release N-1 (from the Lockfile as a real user would have it), apply some representative edits, run `aokit update` to release N, and require **zero conflicts** and a green build. A conflict here means the release changed a `managed` file in a way a user's normal edits cannot survive, so the release needs a migration or a smaller change ([lifecycle](lifecycle.md#migrations)).
