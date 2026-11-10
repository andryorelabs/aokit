# Writing a Module

Write your own Module with `defineModule` from `@aokit/module`, compile it to a manifest and serve it from a Registry. The rules behind every field are in the [Module contract](../architecture/module-contract.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

## What a Module is

A Module adds one unit of capability to a Project. It is authored in TypeScript and compiled to a JSON manifest, `module.json`. Only the JSON is published, and the Resolver never runs your TypeScript. A Module never edits another Module: it reaches the rest of the Project through Capabilities it requires and Extension points it contributes to ([Capabilities](../architecture/capabilities.md)).

## Set up

`@aokit/module` ships ESM JavaScript and `.d.ts` declarations at the same version as `aokit`. Install it in a directory of your own:

```sh
mkdir my-registry-src && cd my-registry-src
bun init -y
bun add -d @aokit/module
```

Use the same version as the `aokit` CLI your users run, so the manifest you type-check is one that CLI accepts ([ADR 0027](../adr/0027-module-sdk-is-published.md)).

## Declare the Module

A Module that adds a Git hook runner and one config file:

```ts
import { defineModule } from "@aokit/module";

export default defineModule({
  name: "my-lint-staged",
  version: "1.0.0",
  provides: [{ capability: "staged-lint", cardinality: { max: 1 } }],
  requires: ["git-hooks"],
  files: [
    {
      from: "files/lintstagedrc.json",
      to: ".lintstagedrc.json",
      target: "config",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      "lint-staged": { range: "^16.0.0" },
    },
  },
  ops: [
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { "lint:staged": "lint-staged" } },
    },
  ],
});
```

`defineModule` only type-checks the declaration and returns it. Put the plain source files beside it, in `files/lintstagedrc.json` here. Files are valid source with no template language.

- `name` is kebab-case and unique within a Registry. `version` is semver and immutable once published: a change is a new version.
- `provides` lists the Capabilities you offer, each with a Cardinality. `requires` lists Capabilities another selected Module must provide. `conflicts` lists Modules or Capabilities that must not be selected with yours. See [Capabilities](../architecture/capabilities.md).
- `files` copies files into a logical Target such as `root`, `config`, `web` or `server`. The Layout resolves where a Target lives, so the same Module works in the single and monorepo Layouts ([Layouts](../architecture/layouts.md)). Use `ownership: "seed"` for a file written once that the user then owns, such as a starter page.
- `deps` names npm dependencies per type. A literal range such as `^16.0.0` works anywhere. `range: "catalog"` takes the version from the Catalog of the Registry Release, so use it only if your Registry ships one.
- `ops` are declarative edits (`mergeJson`, `appendRegion` and more) at files or Extension points. See the [ops catalog](../architecture/engine.md#ops-catalog).
- `extensionPoints` lets a base Module offer anchors that other Modules contribute to.
- `answers` declares questions the Module asks, and `env` the environment variables it needs.

## Compile it

`compileModule` validates the declaration and writes the sorted `module.json`:

```ts
import { compileModule } from "@aokit/module";

await compileModule("./my-lint-staged/module.ts", {
  outFile: "./out/modules/my-lint-staged/1.0.0/module.json",
});
```

Run it with `bun compile.ts`. An invalid manifest throws with the field that failed. An unknown field is an error, not ignored, so typos surface early.

## Serve it from a Registry

A Registry is an `index.json` plus one immutable directory per Module version, with `module.json` and the `files/` it lists, laid out as in the [Registry protocol](../architecture/registry.md#layout-of-a-registry). The index records an `integrity` hash for every version, computed over the manifest and files. aokit does not ship a command that builds a Registry yet. The repository's own builder, [`tools/registry-build/build.ts`](../../tools/registry-build/build.ts), is the reference for computing the index and the Catalog.

Once you have a Registry, [host it](hosting-a-registry.md) and try the Module:

```sh
aokit add my-lint-staged --registry ./my-registry --dry-run
```

`--dry-run` builds the Plan and writes nothing, and `--diff` prints it as unified diffs. A local directory Registry is trusted by default. A remote one needs `--trust`, as the hosting guide explains.

## Rules to keep

- A published version never changes. Fix a bug by publishing a new version; `update` renders old versions from the Lockfile.
- Two Modules cannot write the same file or Op result. A Module that must replace another's output declares an [override](../architecture/module-contract.md#override).
- Generation is deterministic: no timestamps, no generated secrets ([ADR 0012](../adr/0012-deterministic-generation-and-atomic-writes.md)).
- Arbitrary transform code runs only from a trusted Registry, and declarative Ops are preferred ([Security model](../security.md#hostile-modules)).
