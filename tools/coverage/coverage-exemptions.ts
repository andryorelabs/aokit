/**
 * Reason for internal modules that tests reach only through a sibling entry point.
 */
const reachedThroughEntryPoint =
  "internal module with no direct test; exercised through its directory entry point, which tests import, and measured by the coverage threshold";

/**
 * Reason for process entry points.
 */
const spawnedProcessEntry =
  "process entry point; exercised end to end by tests that spawn the CLI, which the in-process coverage profile cannot attribute to this file";

/**
 * Reason for generated or embedded artifacts.
 */
const generatedModule =
  "generated or embedded artifact; its content is verified by the registry build and determinism tests";

/**
 * Source modules that no test imports directly, each with the reason it is covered another way or not at all.
 * Add a test instead of adding an entry; remove an entry as soon as a test imports the module.
 */
export const coverageExemptions: Readonly<Record<string, string>> = {
  "packages/aokit/src/apply/apply.ts": reachedThroughEntryPoint,
  "packages/aokit/src/apply/conflicts.ts": reachedThroughEntryPoint,
  "packages/aokit/src/apply/errors.ts": reachedThroughEntryPoint,
  "packages/aokit/src/apply/sequence.ts": reachedThroughEntryPoint,
  "packages/aokit/src/cli/binary.ts": spawnedProcessEntry,
  "packages/aokit/src/cli/main.ts": spawnedProcessEntry,
  "packages/aokit/src/cli/update-notice/spawn.ts": spawnedProcessEntry,
  "packages/aokit/src/create/target.ts": reachedThroughEntryPoint,
  "packages/aokit/src/drift/checks.ts": reachedThroughEntryPoint,
  "packages/aokit/src/drift/index.ts": reachedThroughEntryPoint,
  "packages/aokit/src/drift/unknown.ts": reachedThroughEntryPoint,
  "packages/aokit/src/engine/build.ts": reachedThroughEntryPoint,
  "packages/aokit/src/engine/errors.ts": reachedThroughEntryPoint,
  "packages/aokit/src/engine/interpolate.ts": reachedThroughEntryPoint,
  "packages/aokit/src/engine/ops.ts": reachedThroughEntryPoint,
  "packages/aokit/src/format/errors.ts": reachedThroughEntryPoint,
  "packages/aokit/src/git/clean-tree.ts": reachedThroughEntryPoint,
  "packages/aokit/src/git/git.ts": reachedThroughEntryPoint,
  "packages/aokit/src/layout/migrate.ts": reachedThroughEntryPoint,
  "packages/aokit/src/lifecycle/keep-deps.ts": reachedThroughEntryPoint,
  "packages/aokit/src/lifecycle/migration-stage.ts": reachedThroughEntryPoint,
  "packages/aokit/src/lockfile/errors.ts": reachedThroughEntryPoint,
  "packages/aokit/src/lockfile/json-schema.ts": reachedThroughEntryPoint,
  "packages/aokit/src/lockfile/migrations.ts": reachedThroughEntryPoint,
  "packages/aokit/src/lockfile/read.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/guidance/static.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/init/client-config.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/init/index.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/init/init.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/result.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/server.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/tools/guidance.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/tools/index.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/tools/plan-add.ts": reachedThroughEntryPoint,
  "packages/aokit/src/mcp/tools/plan-create.ts": reachedThroughEntryPoint,
  "packages/aokit/src/merge/content.ts": reachedThroughEntryPoint,
  "packages/aokit/src/merge/merge-project.ts": reachedThroughEntryPoint,
  "packages/aokit/src/merge/renames.ts": reachedThroughEntryPoint,
  "packages/aokit/src/merger/json.ts": reachedThroughEntryPoint,
  "packages/aokit/src/migrations/run.ts": reachedThroughEntryPoint,
  "packages/aokit/src/migrations/select.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/code/entries.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/code/imports.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/code/queued.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/code/resolve.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/data/deps.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/data/env.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/data/errors.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/data/files.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/data/target.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/data/workspaces.ts": reachedThroughEntryPoint,
  "packages/aokit/src/ops/extension-point.ts": reachedThroughEntryPoint,
  "packages/aokit/src/pipeline/build.ts": reachedThroughEntryPoint,
  "packages/aokit/src/pipeline/render.ts": reachedThroughEntryPoint,
  "packages/aokit/src/project/install.ts": reachedThroughEntryPoint,
  "packages/aokit/src/registry/client.ts": reachedThroughEntryPoint,
  "packages/aokit/src/registry/embedded/generated-registry.ts": generatedModule,
  "packages/aokit/src/registry/embedded/native-oxfmt-library.ts": generatedModule,
  "packages/aokit/src/registry/embedded/native-parser-library.ts": generatedModule,
  "packages/aokit/src/registry/integrity.ts": reachedThroughEntryPoint,
  "packages/aokit/src/registry/read.ts": reachedThroughEntryPoint,
  "packages/aokit/src/resolver/order.ts": reachedThroughEntryPoint,
  "packages/create-aokit/src/main.ts": spawnedProcessEntry,
  "packages/module/src/catalog.ts": reachedThroughEntryPoint,
  "packages/module/src/compile.ts": reachedThroughEntryPoint,
  "packages/module/src/define.ts": reachedThroughEntryPoint,
  "packages/module/src/json-schema.ts": reachedThroughEntryPoint,
  "packages/module/src/manifest.ts": reachedThroughEntryPoint,
  "packages/module/src/migration.ts": reachedThroughEntryPoint,
};
