# Registry protocol and trust model

A Registry is a source of Module manifests that is versioned and integrity-checked. This page fixes the protocol aokit speaks to Registries, the adapter that lets a shadcn registry act as one, and the trust model that decides what a Registry may do. Related: [overview](overview.md), [Module contract](module-contract.md), [Capabilities](capabilities.md), [Layouts](layouts.md), [Engine](engine.md), [Lockfile](lockfile.md).

The Registry client (see the [overview](overview.md)) is the only component that talks to a Registry. It resolves each Module to an exact version, verifies integrity, and hands manifests to the Resolver. The Resolver never executes a Module's TypeScript ([Module contract](module-contract.md#authoring-and-compilation)).

## Registry kinds

| Kind       | Source                                                                                                                                                                                                                                                                                                              | Format                | Trust by default                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------- |
| `official` | The first-party Registry, shipped with the CLI as the default. Until the distribution phase it lives in this repository as `registry/`, compiled from `registry-src/` and read as a local directory; its public host will be `https://registry-aokit.andryore.dev`. The Lockfile records its source as `"bundled"`. | aokit index           | Trusted.                                      |
| `local`    | A directory on disk (`./registry`, `file:` path). The Lockfile records a path relative to the Project directory, resolved from there.                                                                                                                                                                               | aokit index           | Trusted: it is code the user already has.     |
| `remote`   | An `https://` URL that serves the layout below, or a `github:owner/repo#ref` source.                                                                                                                                                                                                                                | aokit index           | Not trusted. See [Trust model](#trust-model). |
| `shadcn`   | A shadcn registry (URL or namespace) read through the [adapter](#shadcn-adapter).                                                                                                                                                                                                                                   | shadcn registry items | Not trusted, and declarative-only.            |

### Resolution order

A Module name is looked up in this order; the first Registry that has it wins:

1. A Registry named explicitly: `--registry <name|source>` (on `create`, `add` and `update`) or a `@ns/module` address.
2. `local` Registries, in the order recorded in the Lockfile.
3. `remote` and `shadcn` Registries, in the order recorded in the Lockfile.
4. `official`.

A Module already in the [Lockfile](lockfile.md) is always fetched from the Registry recorded in its `registry` field, never re-resolved by name. That field points at a key of `registries`, whose `source` is `"bundled"` (the Registry shipped with the CLI), a path relative to the Project directory, an `https://` URL or a `github:` ref, or a shadcn Registry URL or Namespace. Two Registries declaring the same name with different sources is an `INVALID_INPUT` error that names both sources. Two Registries offering the same Module name is not an error when the lookup is unambiguous by the order above; the Plan shows which Registry supplied each Module. Capability names are owned by the Registry that first uses them ([Capabilities](capabilities.md#naming)), and the Resolver reports a disagreement on [Cardinality](capabilities.md#cardinality) as a Registry warning.

## aokit manifest index

The own protocol is plain JSON over HTTPS, a directory, or a git source. It is inspired by the shadcn registry (a root index that lists items, each item a JSON file) with the additions aokit needs: versions, integrity, and a Catalog.

### Layout of a Registry

```text
index.json                              # the registry index
modules/<name>/<version>/module.json    # one compiled manifest per module version
modules/<name>/<version>/files/...      # the files the manifest lists in `files[].from`
modules/<name>/<version>/migrations/... # compiled Migration scripts, when the manifest lists any
modules/<name>/<version>/renames.json   # optional Renames manifest, previous version to this one
catalog/<release>.json                  # the Catalog for one Release
```

The migration scripts and `renames.json` are listed in the version's `files` hashes and covered by its `integrity` like any other file. Every Module version has its own immutable directory, and every [Release](../../GLOSSARY.md) has its own Catalog file. Building the Registry (`bun run registry:build`) only **adds** versions and Releases: it never deletes an existing one, and it fails naming `<module>@<version>` if the content of an already published version would change. The reader offers the `latest` view, lookup by `name@version`, and the Catalog of a given Release.

### Index shape

```json
{
  "$schema": "https://aokit.andryore.dev/schema/registry/v1.json",
  "schemaVersion": 1,
  "name": "aokit",
  "release": "2026.11.0",
  "minCliVersion": "0.1.0",
  "releases": {
    "2026.11.0": { "path": "catalog/2026.11.0.json", "integrity": "sha256-<hex>" }
  },
  "modules": {
    "oxc": {
      "latest": "1.0.0",
      "versions": {
        "1.0.0": {
          "manifest": "modules/oxc/1.0.0/module.json",
          "integrity": "sha256-<hex>",
          "schemaVersion": 1,
          "provides": ["lint", "format"]
        }
      }
    }
  }
}
```

| Field                         | Meaning                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$schema`, `schemaVersion`    | Versioned like Module manifests: a CLI reads indexes up to the `schemaVersion` it supports; a newer one fails with an error that tells the user to update the CLI, and unknown fields are an error ([Schema versioning](module-contract.md#schema-versioning)).                                        |
| `name`                        | The Registry name, used in `@name/module` addresses and recorded in the Lockfile `registry` field.                                                                                                                                                                                                     |
| `release`                     | Identifier of the current Release, which is also the stem of `catalog/<release>.json`.                                                                                                                                                                                                                 |
| `releases`                    | Every Release the Registry has published, each with the path and integrity of its own Catalog file, so a Project can be rendered at the Release its Lockfile records.                                                                                                                                  |
| `minCliVersion`               | Lowest CLI version able to use this release. The Lockfile records it per release ([Lockfile](lockfile.md)); a CLI below it stops with an update instruction before any fetch.                                                                                                                          |
| `modules.<name>.latest`       | The version `add` selects when the user gives none.                                                                                                                                                                                                                                                    |
| `modules.<name>.versions.<v>` | A version entry: `manifest` path, `integrity` over the manifest and the Module's files ([Trust model](#integrity)), and a summary (`provides`) so the Resolver can list candidates without downloading every manifest. The manifest is authoritative; a mismatch with the summary is a Registry error. |

The index lists first-party Capability names too, so errors can suggest providers ([Capabilities](capabilities.md#error-messages)).

### Catalog per release

`catalog/<release>.json` is the [Catalog](../../GLOSSARY.md): the dependency versions a release ships, tested together. It is what `range: "catalog"` resolves against ([`deps`](module-contract.md#deps)).

```json
{
  "$schema": "https://aokit.andryore.dev/schema/catalog/v1.json",
  "schemaVersion": 1,
  "release": "2026.11.0",
  "dependencies": {
    "zod": "^4.0.0",
    "oxlint": "1.90.0",
    "oxfmt": "0.75.0"
  },
  "pinGroups": { "oxc": ["oxlint", "oxfmt"] }
}
```

Entries in a `pinGroups` group are the Toolchain pin group: pinned exactly regardless of the default range policy; everything else is a range. Keys are sorted and the file has no timestamps, so it is stable under hashing. A plain JSON file at a known path is also what Renovate updates, since Renovate has no Bun catalog support; the dependency policy is specified with the update docs.

### Immutability

A published `modules/<name>/<version>/` and its files never change. A fix is a new version. Consequences:

- A version entry's `integrity` is permanent; a Registry that serves different bytes for it is faulty or compromised and the client rejects them.
- Old versions stay fetchable for as long as any Project may reference them. A Registry may yank a version (flagged in the index so `add` will not select it) but must keep serving it, because `update` renders the old version from the Lockfile ([Lockfile](lockfile.md)).
- The client keeps a local cache of fetched versions at `$XDG_CACHE_HOME/aokit/registry/<integrity>/` (default `~/.cache/aokit/registry/<integrity>/`). A cache hit is verified again before use, a corrupted entry is discarded and fetched again, and nothing is evicted automatically.
- A yanked version carries `yanked: true` in the index, set by the build from `registry-src/yanked.json` (a list of `<module>@<version>`). `add`, `create` and `update` never select it; it is still served and verified.
- The `latest` pointer and the Catalog of a `release` are the only mutable-by-addition parts: a new release adds a new `catalog/<release>.json`, it never edits an old one.

## shadcn adapter

The adapter reads a shadcn registry (a `registry.json` index and per-item JSON files following the registry-item schema) and presents each item as a synthetic Module manifest. It lets Andry's projects consume shadcn components without rewriting them, while every guarantee below the adapter (Plan, Lockfile, ownership, integrity) stays aokit's.

Adapted items are declarative only. They map to `files`, `deps`, `env`, and a small set of Ops; they never carry a transform ([Trusted registries and arbitrary code](module-contract.md#trusted-registries-and-arbitrary-code)).

### Item type mapping

shadcn's twelve item types map to aokit concepts as follows.

| shadcn item type     | aokit concept                                                           | Notes                                                                                      |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `registry:ui`        | Module `files` to Target `shared-ui`                                    | A primitive component.                                                                     |
| `registry:component` | Module `files` to Target `shared-ui`                                    | A composed component.                                                                      |
| `registry:block`     | Module `files` to Targets `web` and `shared-ui`                         | Multi-file; each file keeps its own `target` field when given, else `web`.                 |
| `registry:page`      | Module `files` to Target `web`                                          | A route file; its `target` path is a path inside the Target, not a repo path.              |
| `registry:hook`      | Module `files` to Target `shared-ui` (`hooks/`)                         | Alias `@hooks/`.                                                                           |
| `registry:lib`       | Module `files` to Target `shared-ui` (`lib/`)                           | Alias `@lib/`.                                                                             |
| `registry:file`      | Module `files` to the Target implied by its `target` field, else `root` | An arbitrary file; `target` paths starting `~/` resolve against `root`.                    |
| `registry:theme`     | Ops on the Tailwind entry CSS (`css`, `cssVars`)                        | Contributes to the CSS Extension point of the `tailwind4` Module.                          |
| `registry:style`     | Ops on the Tailwind entry CSS plus `deps`                               | A style bundle: `css`, `cssVars`, `registryDependencies`, `dependencies`.                  |
| `registry:base`      | Module `deps` plus `base.config` handling                               | The base a style set builds on; see [`base.config`](#css-cssvars-envvars-font-baseconfig). |
| `registry:font`      | `font` handling                                                         | See below.                                                                                 |
| `registry:item`      | A generic Module built only from the generic fields                     | Used when no more specific type applies.                                                   |

Unknown types fail with an error naming the item, they are never skipped silently.

### Alias placeholders

Item file paths and content may use alias placeholders. The adapter resolves them to Targets, never to paths, so the [Layout](layouts.md) decides the final location ([Layouts](layouts.md#targets)).

| Placeholder    | Resolves to                               |
| -------------- | ----------------------------------------- |
| `@components/` | Target `shared-ui`, subpath `components/` |
| `@ui/`         | Target `shared-ui`, subpath `ui/`         |
| `@lib/`        | Target `shared-ui`, subpath `lib/`        |
| `@hooks/`      | Target `shared-ui`, subpath `hooks/`      |
| `~/`           | Target `root`                             |

Placeholders in file content (imports) are rewritten to the import specifier that matches the resolved location in the chosen Layout (a relative or workspace-package specifier). A placeholder the adapter does not know is an error that names the item and the placeholder.

### `css`, `cssVars`, `envVars`, `font`, `base.config`

| shadcn field                      | aokit mapping                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `css`                             | A postcss-based Op on the Tailwind v4 entry file (`@import`, `@plugin`, `@theme`, rules), applied at the Tailwind Module's CSS Extension point ([Engine](engine.md#ops-catalog)). |
| `cssVars`                         | CSS variable Ops under the `theme`, `light` and `dark` groups of the same Extension point; existing variables are never overwritten without an `override`.                        |
| `envVars`                         | The Module `env` list, written by the line-based `.env` patcher that never overwrites existing keys.                                                                              |
| `font`                            | `deps` for the font package plus a CSS Op for the `--font-*` variable and the Extension point for loading it.                                                                     |
| `base.config`                     | Merged into the config of the UI Module the base targets (for shadcn, its component config) by `mergeJson`; it records the base choice in the Lockfile `answers`.                 |
| `dependencies`, `devDependencies` | `deps`; ranges as given, since a shadcn registry has no Catalog.                                                                                                                  |
| `files[].content`                 | Embedded file content, treated like `files[].from`; hashed per file.                                                                                                              |

### `registryDependencies`: five address forms

`registryDependencies` becomes `requires` between adapted Modules. Each entry is parsed into one of five address forms:

| Form                  | Example                             | Resolved by                                                                                                                                       |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bare name             | `button`                            | The same shadcn registry as the item that lists it.                                                                                               |
| Namespaced            | `@acme/button`                      | The Registry configured under the namespace `@acme` (see [Namespaced registries](#namespaced-registries-and-auth)).                               |
| `owner/repo/item#ref` | `acme/ui/button#v2`                 | A GitHub repository through the `github:` transport; `#ref` is resolved to a full commit SHA (sha40) and pinned ([Pinning](#commit-sha-pinning)). |
| URL                   | `https://example.com/r/button.json` | The URL of one registry-item JSON file; treated as a `remote` source.                                                                             |
| Local path            | `./registry/button.json`            | A file on disk; treated as `local`.                                                                                                               |

Each dependency is fetched and integrity-checked like any other Module. A dependency from a different Registry than its dependent is allowed but each Registry is checked against the [trust model](#trust-model) separately.

### Namespaced registries and auth

Namespaces are configured under `registries` in the user config (`$XDG_CONFIG_HOME/aokit/config.json`). They are always shadcn kind, `url` must contain `{name}`, and `@shadcn` (`https://ui.shadcn.com/r/{name}.json`) is built in and untrusted until trusted:

```json
{
  "registries": {
    "@acme": {
      "url": "https://registry.acme.dev/r/{name}.json",
      "headers": { "Authorization": "Bearer ${ACME_REGISTRY_TOKEN}" }
    }
  }
}
```

- `${VAR}` in `url` and `headers` is expanded from the process environment (and `.env`) at request time.
- Expanded values are never written to the Lockfile, to logs, or to `--json` output; an unset variable is an error that names it.
- Headers are sent only to the origin (scheme, host and port) of that namespace and are dropped on a redirect to another origin.
- An unset variable fails with `REGISTRY_ENV_UNSET`.
- The config stores the placeholder, not the secret.

### What shadcn lacks and aokit adds

shadcn has no lockfile and no integrity hash: an item is fetched and written, and nothing records which version or bytes it was. The adapter adds, for adapted Modules:

- A synthetic semver version `0.0.0-shadcn.<12hex>`, where the hex is a prefix of the commit SHA for git sources, otherwise of the sha256 of the item JSON; the full integrity is stored beside it. The Module is named `@ns/item` (an un-namespaced Registry uses its Lockfile Registry key as scope).
- `registry` and `integrity` entries in the [Lockfile](lockfile.md), as for any Module.
- sha256 per file, per-file Ownership mode (`seed` for `page` and `file` items, `managed` otherwise) and ownership of the CSS and `.env` regions the item touched, so `update`, `doctor` and `remove` work.
- A fetch-time check against the recorded `integrity`: when the upstream item changed, the CLI reports it as an update, never silently re-applies it. The integrity cache is mandatory for shadcn items; when the recorded integrity is neither cached nor served, `doctor` and `remove` fail with `REGISTRY_ITEM_CHANGED` and suggest `update`.
- Deferred item types: `registry:base` and `registry:font` fail with `REGISTRY_ITEM_UNSUPPORTED` naming the item. See [ADR 0018](../adr/0018-shadcn-items-are-adapted-modules.md).

## Trust model

### Integrity

- Every Module version has one `integrity` in the index, computed over its canonical manifest and its files (each file as its sorted path plus LF-normalized content). The index also lists each file's own sha256. The client recomputes them over the canonical bytes and rejects a mismatch before anything enters the [VFS](engine.md). The error names the Registry, the Module and both values.
- The Lockfile records, per Module, `registry` (the Registry name or source it came from) and `integrity`, **copied verbatim from the index**; per-file hashes live in the `files` map ([Lockfile](lockfile.md#integrity-format)). `add`, `remove`, `recopy`, `update` and `create --from` re-verify against these.
- Integrity is stored as `sha256-<lowercase hex>`, the same format in the Registry index, the Catalog pointer and the Lockfile; the algorithm is part of the string so a stronger hash can be added later without a protocol break.
- Integrity protects against a changed or corrupted artifact. It does not make a malicious Registry harmless; the trust model below does that.

### Commit-SHA pinning

A remote source given as a mutable reference is resolved once and pinned:

- **Git** sources (`github:owner/repo#ref`): `ref` (branch, tag or none) is resolved to a full 40-hex commit SHA with `git ls-remote` on first use, unless it already is one. Files are read from `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`. The Lockfile `registries.<name>.source` records `github:owner/repo#<sha>`, never the moving ref.
- **URL** sources: the URL is recorded as given. The index is append-only and changes with every new version, so it is not hashed; the pin is the per-Module `integrity` recorded in the Lockfile, which every fetch is compared against.
- Only `update --registry github:owner/repo#<ref>` moves a Pin: it resolves the ref again and shows the new SHA in the Plan. A plain `update` never does.

### Trusted and untrusted Registries

`official` and `local` Registries are trusted. Any other Registry (`remote`, `shadcn`) is untrusted until the user allows it.

**When a prompt appears.** The CLI asks for trust exactly once per Registry, at the first command that would fetch from a Registry that is not first-party and not in the allowlist: `create`, `add`, `update` or `create --from` with a new source. The prompt names the Registry (URL and pinned SHA), what it will fetch and what trusting it enables. It does not appear again for an allowlisted Registry or for one already recorded as trusted for this Project in the Lockfile. It also appears again if the Registry's source changes (a different host, or a different repository).

**Allowlist.** A Registry is allowed non-interactively by the user config (`$XDG_CONFIG_HOME/aokit/config.json`, default `~/.config/aokit/config.json`, key `trustedRegistries: [{ name, source }]`), by `--trust <name|source>` on the command (repeatable; a name must come with the source it was allowed for), or by `registries.<name>.trusted: true` in the Project's Lockfile. The prompt answers `yes`, `no` or `always`; `always` writes the user config, and `yes` records `trusted` in the Lockfile when the command applies.

**Non-interactive runs.** `--yes` never grants trust. With no TTY, with `--yes`, or when a coding agent is detected (`CI`, `CLAUDECODE`, `CURSOR_AGENT`, `CODEX_SANDBOX`, `GEMINI_CLI` or `AOKIT_AGENT` is set), an untrusted, non-allowlisted Registry makes the command fail with `REGISTRY_UNTRUSTED` (exit `5`) and an actionable error that shows the exact `--trust` form; nothing beyond the index is fetched.

**Blocked by default for untrusted Registries:**

| Capability                                                               | Default                                     | How to enable                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Declarative content (`files`, `deps`, `env`, declarative `ops`)          | Allowed after the trust prompt or allowlist | Prompt or allowlist                                                                |
| Arbitrary transform code                                                 | Blocked                                     | Trust the Registry (prompt or allowlist); shadcn-adapted items can never carry one |
| Remote scripts (lifecycle or install hooks fetched from the Registry)    | Blocked                                     | Explicit per-script consent each time, not covered by the allowlist                |
| Running anything during the deterministic phase that installs or fetches | Never allowed                               | Not configurable ([Engine](engine.md#determinism))                                 |

Arbitrary transforms are honored only from a trusted Registry and are integrity-checked with the Module, as the [Module contract](module-contract.md#trusted-registries-and-arbitrary-code) states. No remote script runs without consent; "consent" means a prompt that shows the script, or the matching `--allow-script <module>` flag.

### Failure and reporting

- Integrity mismatch (`REGISTRY_INTEGRITY_MISMATCH`, exit `1`), unknown `schemaVersion`, and `minCliVersion` above the CLI version are hard errors that name the Registry, the Module and the expected versus actual value. A failed fetch is `REGISTRY_FETCH_FAILED` (exit `1`) and leaves the Project unchanged.
- An index `files` entry that is absolute or escapes the Module directory is rejected before any fetch or cache write.
- A fetch from an untrusted source is reported in the Plan with the Registry, pinned SHA and integrity, so the user can review it before apply.

## Dependencies on other docs

- Lockfile fields (`registry`, `integrity`, per-file hash, `minCliVersion`): [Lockfile](lockfile.md).
- Manifest fields and the arbitrary-transform rule: [Module contract](module-contract.md).
- Capabilities, Cardinality and Extension points used by adapted Modules: [Capabilities](capabilities.md).
- Targets and alias resolution: [Layouts](layouts.md).
- VFS, Plan and Ops: [Engine](engine.md).
