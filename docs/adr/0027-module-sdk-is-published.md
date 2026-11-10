# 0027. The Module SDK is published

Status: Accepted (2026-11-10)
Spec: S6 (public-use readiness spec)
Architecture: [Distribution: publishing to npm](../architecture/distribution.md#publishing-to-npm), [Module contract](../architecture/module-contract.md)

## Context

`@aokit/module` is the contract Module authors write against: `defineModule`, the manifest schema and the op types. The `aokit` bundle inlines it, so the CLI never needed it on npm, and the first versions kept it private. The Module contract docs, however, tell third-party authors to `import { defineModule } from "@aokit/module"`. A Module author outside this repository cannot do that while the package is private, so the documented path to a third-party Registry is closed.

## Decision

- `@aokit/module` is published to npm under the `aokit` organization, public, with npm trusted publishing and provenance from `release.yml`, like `aokit` and `create-aokit`.
- It ships built ESM JavaScript (`index.js`) and TypeScript declarations (`.d.ts`) only: no `src/*.ts` and no tests. `zod` stays a runtime dependency.
- `bun run build:package` stages it in `packages/module/dist/` with its own publish manifest, and that directory is what is packed and published. The workspace manifest keeps `exports` on `./src/index.ts`, so the repository's own Modules and tests resolve source without a build; its `publishConfig.exports` names the built files and the staging step turns them into the published `exports`. Neither `npm pack` nor `bun pm pack` applies `publishConfig.exports` by itself.
- It shares one version with `aokit` and `create-aokit`, and `bump.config.ts` bumps all three. A manifest that `@aokit/module@x.y.z` accepts is one `aokit@x.y.z` accepts. This extends the shared version of [ADR 0026](0026-registry-releases-are-dated-cli-versions-are-semver.md) to a third package.
- An exported type or schema change is a breaking change unless it only adds optional fields ([packages/module rules](../../packages/module/AGENTS.md)).

## Consequences

- Third-party Module authors get typed manifests from npm, which the authoring guides can point to.
- The SDK becomes a public API: changes to it follow the package's semver, and the tarball contents are asserted by a test in `tools/build-package`.
- The owner creates the npm org `aokit` and publishes the first version by hand before trusted publishing can be configured ([`tools/release/human-steps.sh`](../../tools/release/human-steps.sh)).
- A release now publishes three packages; the release workflow packs `@aokit/module` from `packages/module/dist`.

## Alternatives considered

- **Keep it private and tell authors to copy the types**: rejected. The contract would drift, and `defineModule` exists to type-check against the one schema ([ADR 0009](0009-one-zod-schema-for-all-interfaces.md)).
- **Publish the TypeScript source**: rejected. Consumers on Node or with a different `tsconfig` would compile aokit's sources, and the tarball would carry tests and dev-only files.
- **An independent version line**: rejected. One version for the three packages keeps "which SDK matches my CLI" trivial.
- **Rewrite `package.json` in a `prepack` hook**: rejected. It edits a tracked file during packing and leaves it dirty when packing fails; staging in `dist/` changes nothing tracked.
