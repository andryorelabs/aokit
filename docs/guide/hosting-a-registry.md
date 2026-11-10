# Hosting a Registry

Serve your Modules from a local directory, an `https://` URL or a GitHub repository, and decide who trusts it. The protocol is in [Registry protocol and trust model](../architecture/registry.md) and the threat model in [Security model](../security.md). To write the Modules themselves, see [Writing a Module](writing-modules.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## The layout

Every Registry serves the same layout, whatever transport carries it:

```text
index.json                              # the Registry index
modules/<name>/<version>/module.json    # one compiled manifest per Module version
modules/<name>/<version>/files/...      # the files the manifest lists
catalog/<release>.json                  # the Catalog for one Release
```

A published `modules/<name>/<version>/` never changes; a fix is a new version. The index records an `integrity` hash per version, and every client recomputes it and rejects a mismatch. The full field list is in [Index shape](../architecture/registry.md#index-shape). aokit has no command that builds this layout yet; [`tools/registry-build/build.ts`](../../tools/registry-build/build.ts) is the reference implementation.

## Local directory

The simplest Registry is a directory on disk. Pass its path with `--registry`:

```sh
aokit create my-app --registry ./my-registry
aokit add my-module --registry ../my-registry
```

A local Registry is trusted: it is code you already have. The Lockfile records its path relative to the Project directory, so keep that relative path valid for everyone who runs `aokit update` on the Project.

Trusted also means executable: a Migration served from a local Registry is code that runs on your machine during `aokit update`, with your permissions. Read the Migrations of a Registry directory before you point a Project at it.

## `https://`

Serve the same directory from any static host and pass the URL of its root:

```sh
aokit create my-app --registry https://registry.example.com
```

The URL is recorded in the Lockfile as given. Because the index changes with every new version, it is not hashed as a whole. The pin is the per-Module `integrity` the Lockfile records, which every later fetch is compared against.

## `github:owner/repo#ref`

Commit the layout to a GitHub repository and point at a branch, tag or commit:

```sh
aokit create my-app --registry github:acme/aokit-modules#main
```

The ref is resolved once to a 40-hex commit SHA and the Lockfile records `github:acme/aokit-modules#<sha>`, never the moving ref. A plain `aokit update` does not move that Pin. To pick up newer commits, run `aokit update --registry github:acme/aokit-modules#main`; the Plan shows the new SHA before you apply it.

## Trust

A local Registry and the bundled one are trusted. Every other Registry, `https://` or `github:`, is untrusted until the user allows it. Before a command fetches from one, the trust gate decides:

- An interactive run asks once, naming the Registry, its pinned SHA and what trusting it enables. Answering `always` writes the user config.
- `--trust <name|source>` allows it for that one command. It is repeatable, and a name must come with the source it was allowed for.
- The allowlist, `trustedRegistries` in the user config, allows it every time.
- `registries.<name>.trusted: true` in a Project's Lockfile allows it for that Project.

```sh
aokit add my-module --registry github:acme/aokit-modules#main --trust github:acme/aokit-modules#main
```

The allowlist lives in `$XDG_CONFIG_HOME/aokit/config.json` (default `~/.config/aokit/config.json`):

```json
{
  "trustedRegistries": [{ "name": "acme", "source": "github:acme/aokit-modules#main" }]
}
```

`--yes` never grants trust. With no terminal, with `--yes` or under a coding agent, an untrusted Registry fails with `REGISTRY_UNTRUSTED` (exit `5`) and the error prints the exact `--trust` form to use. Nothing beyond the index is fetched.

What trust enables: declarative `files`, `deps`, `env` and `ops` are allowed after the prompt or the allowlist. Arbitrary transform code is honored only from a trusted Registry, and remote lifecycle or install scripts are always blocked. Trusting a Registry covers every Module it serves, including versions published later, so trust only a Registry you would run a script from ([Known limits](../security.md#known-limits)).

A Lockfile fetched with `create --from <url>` never carries trust: its `trusted` flags are not the user's decision.

## Choosing a Registry per command

`--registry <name|source>` works on `create`, `add` and `update`. On `create` and `add` it names the Registry to look Modules up in first. On `update` it names a Registry already in the Lockfile, by name or source. A Module already in the Lockfile is always fetched from the Registry it records, never looked up again by name. The order is in [Resolution order](../architecture/registry.md#resolution-order).

To reproduce a Project elsewhere, `aokit create my-copy --from ./aokit.lock.json` reuses the Registries and Module versions the Lockfile records.

## Check it before you publish

- `--dry-run` or `--diff` on `create`, `add` and `update` print the Plan and write nothing. For an untrusted source the Plan names the Registry, the pinned SHA and the integrity.
- `aokit doctor` checks a Project's integrity and Drift; it is read-only.
- An integrity mismatch fails with `REGISTRY_INTEGRITY_MISMATCH` and a failed fetch with `REGISTRY_FETCH_FAILED`; both leave the Project unchanged ([error codes](../reference/cli.md#error-codes)).
