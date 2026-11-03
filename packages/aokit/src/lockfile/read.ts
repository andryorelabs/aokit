import { readFile } from "node:fs/promises";
import { LockfileError } from "./errors.ts";
import { lockfileMigrations, runMigrationChain, type LockfileMigration } from "./migrations.ts";
import { currentLockfileVersion, lockfileSchema, type Lockfile } from "./schema.ts";

export interface ParseLockfileOptions {
  supportedVersion?: number;
  migrations?: readonly LockfileMigration[];
}

export interface ParsedLockfile {
  lockfile: Lockfile;
  /** The on-disk version when it was older and migrated in memory; otherwise `null`. */
  upgradedFrom: number | null;
}

/**
 * Parses Lockfile text: version check, chained migrations, strict validation. Pure; the
 * upgraded result is only written by the next apply.
 */
export function parseLockfile(text: string, options: ParseLockfileOptions = {}): ParsedLockfile {
  const supported = options.supportedVersion ?? currentLockfileVersion;
  const migrations = options.migrations ?? lockfileMigrations;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new LockfileError(
      "LOCKFILE_INVALID_JSON",
      `aokit.lock.json is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      "Restore the file from version control or regenerate it.",
    );
  }

  const version = readVersion(raw);
  if (version > supported) {
    throw new LockfileError(
      "LOCKFILE_TOO_NEW",
      `aokit.lock.json has lockfileVersion ${version}, but this CLI supports up to ${supported}.`,
      "Update the CLI.",
    );
  }

  const upgraded = version < supported;
  const migrated = upgraded ? runMigrationChain(raw, version, supported, migrations) : raw;
  const result = lockfileSchema.safeParse(migrated);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new LockfileError(
      "LOCKFILE_INVALID",
      `aokit.lock.json is invalid: ${details}`,
      "Restore the file from version control or regenerate it.",
    );
  }
  return { lockfile: result.data, upgradedFrom: upgraded ? version : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readVersion(raw: unknown): number {
  const value = isRecord(raw) ? raw.lockfileVersion : undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new LockfileError(
      "LOCKFILE_INVALID_VERSION",
      "aokit.lock.json has no valid integer lockfileVersion.",
      "Restore the file from version control or regenerate it.",
    );
  }
  return value;
}

/**
 * Reads and parses a Lockfile from disk; `null` when absent. Never writes.
 */
export async function readLockfile(
  path: string,
  options: ParseLockfileOptions = {},
): Promise<ParsedLockfile | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause.code === "ENOENT") {
      return null;
    }
    throw cause;
  }
  return parseLockfile(text, options);
}
