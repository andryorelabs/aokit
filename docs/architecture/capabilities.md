# Capabilities

A Capability is a named thing a Module provides or requires. This model replaces per-combination compatibility rules: the Resolver derives what works from declarations alone. Field syntax is in the [Module contract](module-contract.md); how the Engine uses Extension points is in the [Engine](engine.md); the product-level picture is in the [overview](overview.md).

## Naming

- Lowercase kebab-case, optionally namespaced with `:` to narrow a family: `orm`, `auth`, `lint`, `format`, `test-runner`, `db:postgres`, `api:rpc`, `deploy`.
- A bare name is a role (`orm`); a namespaced name is a specific flavor of it (`db:postgres`). A Module that provides `db:postgres` does not implicitly provide `db`; if it should satisfy both, it lists both.
- Names describe what is offered, never who offers it. `requires: ["orm"]` is correct; `requires: ["prisma"]` is not. Excluding a specific Module is done with `conflicts`.
- Names are owned by the Registry that first uses them; first-party names are listed in the Registry index.

## Cardinality

Cardinality is the number of Modules that may provide one Capability in a Project. It is declared where the Capability is provided:

```ts
provides: [{ capability: "orm", cardinality: { max: 1 } }];
provides: [{ capability: "deploy", cardinality: "many" }];
```

| Capability       | Cardinality | Effect                                    |
| ---------------- | ----------- | ----------------------------------------- |
| `orm`            | at most one | Selecting two ORMs fails resolution.      |
| `lint`, `format` | at most one | One linter and one formatter per Project. |
| `deploy`         | many        | `docker` and `coolify` can coexist.       |

A bare string in `provides` means `{ max: 1 }`. When two Modules declare different Cardinality for the same Capability, the stricter one wins and the Resolver reports the disagreement as a Registry warning.

## Deriving compatibility

There is no table of valid combinations. A selection is valid when all of the following hold:

1. **Satisfied requirements.** Every entry in a selected Module's `requires` is provided by another selected Module (or by a Module already in the Lockfile).
2. **Cardinality respected.** No Capability exceeds its limit.
3. **No conflicts.** No selected Module lists another selected Module or a provided Capability in `conflicts`.
4. **Acyclic.** Modules ordered by `requires` form a DAG.

`conflicts` is for what Capabilities cannot express, such as two Modules writing the same exclusive file. Most incompatibilities are already expressed by Cardinality (two ORMs) or by a missing `requires` (a Prisma Module requires `db:postgres`). A new Module joins the matrix by declaring itself; no existing Module or rule changes. The CI matrix is generated from the same declarations (capability-derived pairwise combinations across Layouts).

A Module may never require a Layout: `requires` accepts Capabilities and Extension points only, so no Module can demand `monorepo`. See [Layouts](layouts.md).

## Resolution order

1. Parse the selection and answers. A missing `requires` is auto-added only when exactly one provider exists and the user accepted it (`--yes` accepts); ambiguity is an error.
2. Check Cardinality per Capability.
3. Check `conflicts`.
4. Match every `requires` to a provider.
5. Order Modules topologically: a provider comes before its dependents. Ties break by Module name in Unicode codepoint order, so the order is canonical (see [determinism](engine.md#determinism)).
6. Hand the ordered list to the [Engine](engine.md).

## Error messages

Errors name the Module, the Capability and the fix. Examples:

```text
error: module "better-auth" requires capability "orm" but no selected module provides it.
  providers in registry "aokit": prisma (orm, db:postgres)
  fix: aokit add prisma   (or select one with --module prisma)

error: capability "orm" allows at most 1 provider, but 2 are selected: prisma, drizzle.
  fix: remove one of them from the selection.

error: module "docker" conflicts with module "bare-metal" (both write ./Dockerfile).
  fix: choose one, or remove "bare-metal".

error: module "tailwind4" requires capability "web" but no selected module provides it.
  providers: next, vite-react, astro
```

A requirement is never silently auto-added when more than one provider exists.

## Extension points

An Extension point is a named, versioned point that a base Module declares so other Modules contribute without knowing file paths. For example `next` declares `web.providers`; `better-auth` contributes a provider to it with an Op.

Declaration, in the base Module's `extensionPoints`:

```json
{
  "name": "web.providers",
  "version": "1.0.0",
  "target": "web",
  "kind": "array",
  "anchor": "providers"
}
```

- `name`: namespaced, dot-separated (`web.providers`, `server.middleware`, `env.schema`).
- `version`: semver.
- `target`: the [Target](layouts.md#targets) whose files contain the Extension point.
- `kind`: the shape the Engine edits (`array`, `object`, `import-list`, `json`, `region`), which decides which [Ops](engine.md#ops-catalog) apply.
- `anchor`: the stable marker or AST location the Engine finds. Its internals can change in a minor version without breaking contributors. For `json` it is a JSON pointer (`/ignorePatterns`).
- `file`: the file, relative to the `target`, that holds the Extension point. Required for `json` and `region`; data Ops that address the point write this file, so contributors never see a path.

A contributing Module lists the Extension point it needs in `requires` as `ext:web.providers@^1`. The Resolver treats it like a Capability that the base Module provides implicitly, and the Op that uses it names the same range. A missing Extension point or an unmet range yields the same style of error:

```text
error: module "posthog" requires extension point "web.providers@^2" but "next" provides 1.0.0.
  fix: use a posthog release that supports web.providers@^1, or update next.
```

Versioning rules for base Modules:

- Adding an optional anchor or field is a minor change.
- Renaming, removing or changing the `kind` of an Extension point is a major change. The base Module publishes a new major plus a Module migration for existing Projects.
- A base Module may keep a deprecated Extension point for one major version.

Contributors depend on Extension points, never on file paths.
