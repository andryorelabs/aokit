# Module contract

A Module is a unit of capability that can be added to or removed from a Project. It is authored in TypeScript with `defineModule()` and compiled to a JSON manifest; the manifest is what Registries ship and what the Resolver and [Engine](engine.md) consume. This page fixes the manifest. Related: [overview](overview.md), [Capabilities](capabilities.md), [Layouts](layouts.md).

The central rule: **adding a Module never edits other Modules.** A Module reaches other Modules only through Capabilities it requires and Extension points it contributes to.

## Authoring and compilation

```ts
import { defineModule } from "@aokit/module";

export default defineModule({
  name: "oxc",
  version: "1.0.0",
  provides: [
    { capability: "lint", cardinality: { max: 1 } },
    { capability: "format", cardinality: { max: 1 } },
  ],
  // ...
});
```

`defineModule()` is an identity function that type-checks the declaration. A build step evaluates it and writes `module.json`. Only the JSON is published. The manifest is data: the Resolver never executes a Module's TypeScript.

## Field table

| Field             | Type                                               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`         | URL string                                         | JSON Schema of the manifest format, for editors and validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `schemaVersion`   | integer                                            | Manifest format version, see [Schema versioning](#schema-versioning).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `name`            | string                                             | Unique within a Registry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `version`         | semver                                             | Module version. Immutable once published.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `provides`        | `{ capability, cardinality? }[]`                   | Capabilities this Module offers; Cardinality per entry (default `{ max: 1 }`). See [Capabilities](capabilities.md#cardinality).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `requires`        | string[]                                           | Capabilities that must be provided by another selected Module, and Extension points as `ext:<name>@<range>`. Never a Layout.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `conflicts`       | string[]                                           | Module names or Capabilities that must not be selected together with this Module.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `answers`         | schema                                             | Questions the Module asks (feeds `{{var}}` and the prompt schema). Optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `files`           | `{ from, to, target, mode?, ownership? }[]`        | Plain source files copied into a [Target](layouts.md#targets). `to` is relative to the Target and may contain `__name__` and `{{var}}`. File content and data Op strings may also contain `{{target:<name>}}`, replaced by the directory the Layout resolves for that Target (`.` for the root). File content may also contain `{{import:<target>:<subpath>}}`, replaced by the relative import specifier from the importing file to that location in the Layout; an unresolvable Target or a path that leaves the Project fails the build. |
| `deps`            | see [deps](#deps)                                  | npm dependencies, per dependency type, with optional `pinGroup`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `env`             | `{ key, scope, example?, schema?, visibility? }[]` | Environment variables the Module needs; written through the `env` patcher, never overwriting existing keys.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ops`             | [Op](engine.md#ops-catalog)[]                      | Declarative edits at Extension points or files.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `extensionPoints` | `{ name, version, target, kind, anchor, file? }[]` | Extension points this (base) Module declares. See [Capabilities](capabilities.md#extension-points).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `override`        | `{ file \| op, reason }[]`                         | Explicit permission to replace something another Module produced, see [Override](#override).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `migrations`      | `{ from, to, stage, script }[]`                    | Migrations between versions: `from` a semver range, `to` a semver, `stage` `"before"` or `"after"`, `script` a path relative to the version directory. Authored in TypeScript with `defineMigration`; see [Lifecycle: migrations](lifecycle.md#migrations).                                                                                                                                                                                                                                                                                 |

### `files`

`from` is a path inside the Module package. Files are plain and valid source; there is no template language ([Engine](engine.md#no-template-engine)). Each file has an Ownership mode, default `managed`; one-time files such as a starter page use `seed`.

### `deps`

```json
"deps": {
  "devDependencies": {
    "oxlint": { "range": "catalog", "pinGroup": "oxc" },
    "oxfmt":  { "range": "catalog", "pinGroup": "oxc" }
  }
}
```

`range: "catalog"` takes the version from the [Catalog](overview.md#mapping-to-the-glossary) the Registry release ships. By default dependencies resolve to ranges, recorded with a lockfile. A dependency with `pinGroup` belongs to a Toolchain pin group and is pinned exactly regardless of that default. The group is named, so every Module that lists it moves together.

A dependency entry may set `target`. Deps are grouped per Target `package.json`; an entry without `target` goes to the Module's default Target. In a monorepo each lands in its own workspace package. On the single Layout there is one `package.json`, so every entry collapses into it with no duplicate keys.

### `env`

An entry's `example` goes to the `.env` of its `scope` Target. When `schema` is set, the Engine registers `KEY: <schema>` at the `env.server` (default) or `env.client` (`visibility: "client"`) object Extension point that `t3-env` declares on the `config` Target. Without `t3-env` the schema is skipped.

## Integrity

A Module version's `integrity` is not a field the author writes. The Registry build computes it as `sha256-<hex>` over the canonical manifest and the Module's files (sorted path plus LF-normalized content), publishes it in the [Registry index](registry.md#aokit-manifest-index), and the [Lockfile](lockfile.md#integrity-format) copies it verbatim. Editing any file of a published version changes the value, so a version is bumped, never edited in place ([immutability](registry.md#immutability)).

## Schema versioning

- `$schema` points at the versioned JSON Schema for the manifest.
- `schemaVersion` is an integer incremented on any breaking change to the manifest format.
- A CLI reads manifests with `schemaVersion` up to the one it supports. A newer manifest fails with an error that tells the user to update the CLI; it is never half-interpreted.
- Unknown fields in a supported `schemaVersion` are an error, not ignored, so typos surface early.

## Override

By default two Modules cannot produce the same file or the same Op result: the Plan fails with a conflict that names both Modules (provenance, see [Engine](engine.md#change-types-and-provenance)). A Module that must replace another Module's output declares it:

```json
"override": [{ "file": "web:src/app/layout.tsx", "reason": "replaces the default layout shell" }]
```

Semantics:

- `override` applies to exactly the listed file or Op, nothing wider.
- The overridden Module must be selected (or the override is inert and reported by the Resolver as a warning).
- When two Modules override the same item, the Plan fails.
- Overrides are recorded in the Lockfile's `files` ownership, so `update` and `remove` keep them stable.

## Trusted registries and arbitrary code

Declarative Ops cover the common edits. A Module may also ship an arbitrary transform (code that receives the VFS and edits it). This is only honored from a **trusted Registry**: the first-party Registry, or one the user has explicitly allowed. For any other Registry the CLI refuses to run it, naming the Module and the transform. No remote script runs without consent, and every transform is integrity-checked with the Module.

## Worked example: `oxc`

```json
{
  "$schema": "https://aokit.andryore.dev/schema/module/v1.json",
  "schemaVersion": 1,
  "name": "oxc",
  "version": "1.0.0",
  "provides": [
    { "capability": "lint", "cardinality": { "max": 1 } },
    { "capability": "format", "cardinality": { "max": 1 } }
  ],
  "requires": [],
  "conflicts": ["eslint-prettier"],
  "files": [
    {
      "from": "files/oxlintrc.json",
      "to": ".oxlintrc.json",
      "target": "config",
      "ownership": "managed"
    },
    {
      "from": "files/oxfmtrc.json",
      "to": ".oxfmtrc.json",
      "target": "config",
      "ownership": "managed"
    }
  ],
  "deps": {
    "devDependencies": {
      "oxlint": { "range": "catalog", "pinGroup": "oxc" },
      "oxfmt": { "range": "catalog", "pinGroup": "oxc" }
    }
  },
  "env": [],
  "ops": [
    {
      "op": "mergeJson",
      "target": "root",
      "file": "package.json",
      "value": { "scripts": { "lint": "oxlint", "format": "oxfmt" } }
    }
  ],
  "extensionPoints": [
    {
      "name": "lint.ignores",
      "version": "1.0.0",
      "target": "config",
      "kind": "json",
      "anchor": "/ignorePatterns",
      "file": ".oxlintrc.json"
    }
  ]
}
```

How this lines up with the other docs:

- `provides` lists `lint` and `format`, each with Cardinality `max: 1`, matching the table in [Capabilities](capabilities.md#cardinality).
- `conflicts` names a Module that would also provide `lint`/`format`; the Cardinality rule would already reject it, so the entry is a clearer message, not the mechanism.
- `ops` uses `mergeJson` from the [ops catalog](engine.md#ops-catalog) on the `root` Target, so the scripts land in the right `package.json` in either Layout.
- Both `deps` belong to the `oxc` Toolchain pin group and are pinned exactly.
- The formatter Module is the one the [format phase](engine.md#determinism) runs after the Plan is built.
