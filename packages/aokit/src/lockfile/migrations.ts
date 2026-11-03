import { LockfileError } from "./errors.ts";

/**
 * A pure function from one lockfile version's JSON to the next version's JSON.
 */
export interface LockfileMigration {
  from: number;
  to: number;
  migrate(previous: unknown): unknown;
}

/**
 * Registered migrations. Empty while v1 is the only version; each future bump appends `vN -> vN+1`.
 */
export const lockfileMigrations: readonly LockfileMigration[] = [];

/**
 * Runs `vN -> vN+1` migrations in order until `target`. Never skips a version; a missing step
 * or a step that does not advance by exactly one fails.
 */
export function runMigrationChain(
  raw: unknown,
  fromVersion: number,
  target: number,
  migrations: readonly LockfileMigration[],
): unknown {
  let current = raw;
  for (let version = fromVersion; version < target; version += 1) {
    const step = migrations.find((migration) => migration.from === version);
    if (step === undefined || step.to !== version + 1) {
      throw new LockfileError(
        "LOCKFILE_NO_MIGRATION",
        `No migration from lockfileVersion ${version} to ${version + 1}.`,
        "Regenerate the Lockfile with a CLI that supports this version, or update the CLI.",
      );
    }
    current = step.migrate(current);
  }
  return current;
}
