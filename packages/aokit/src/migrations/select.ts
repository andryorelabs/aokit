import type { Migration, ModuleManifest } from "@aokit/module";

/**
 * The Migrations a manifest declares that a jump from `installed` to `target` crosses: the
 * installed version satisfies `from`, and `installed < to <= target`. Sorted by `to` ascending so
 * they chain; Migrations with the same `to` keep manifest order.
 */
export function selectMigrations(
  manifest: { readonly migrations: readonly ModuleManifest["migrations"][number][] },
  installed: string,
  target: string,
): Migration[] {
  return manifest.migrations
    .filter(
      (migration) =>
        Bun.semver.satisfies(installed, migration.from) &&
        Bun.semver.order(installed, migration.to) < 0 &&
        Bun.semver.order(migration.to, target) <= 0,
    )
    .toSorted((left, right) => Bun.semver.order(left.to, right.to));
}
