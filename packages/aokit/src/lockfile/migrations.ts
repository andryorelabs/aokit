import { LockfileError } from "./errors.ts";

/**
 * A pure function from one lockfile version's JSON to the next version's JSON.
 */
export interface LockfileMigration {
  from: number;
  to: number;
  migrate(previous: unknown): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapEntries(
  value: unknown,
  transform: (entry: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => [
      name,
      isRecord(entry) ? transform(entry) : entry,
    ]),
  );
}

const lockfileV2SchemaUrl = "https://aokit.dev/schema/lockfile/v2.json";

/**
 * `v1 -> v2`: every Module becomes `selected: true` (v1 did not distinguish) and every dependency
 * gets `owners`. A Lockfile carries no manifests, so a v1 dependency is attributed to every
 * Module it records; the next write rebuilds `deps` from a Render and replaces this superset
 * with the exact owners. The `"aokit"` pseudo-owner is never produced.
 */
const migrateV1ToV2: LockfileMigration = {
  from: 1,
  to: 2,
  migrate(previous) {
    if (!isRecord(previous)) {
      return previous;
    }
    const moduleNames = isRecord(previous.modules) ? Object.keys(previous.modules).toSorted() : [];
    return {
      ...previous,
      $schema: lockfileV2SchemaUrl,
      lockfileVersion: 2,
      modules: mapEntries(previous.modules, (entry) => ({ ...entry, selected: true })),
      deps: mapEntries(previous.deps, (entry) => ({ ...entry, owners: moduleNames })),
    };
  },
};

/**
 * Registered migrations; each future bump appends `vN -> vN+1`.
 */
export const lockfileMigrations: readonly LockfileMigration[] = [migrateV1ToV2];

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
