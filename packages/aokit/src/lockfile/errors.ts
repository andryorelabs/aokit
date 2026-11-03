export type LockfileErrorCode =
  | "LOCKFILE_INVALID_JSON"
  | "LOCKFILE_INVALID_VERSION"
  | "LOCKFILE_TOO_NEW"
  | "LOCKFILE_NO_MIGRATION"
  | "LOCKFILE_INVALID";

/**
 * Failure while reading, migrating or validating a Lockfile. `fix` tells the user what to do.
 */
export class LockfileError extends Error {
  readonly code: LockfileErrorCode;
  readonly fix: string;

  constructor(code: LockfileErrorCode, message: string, fix: string) {
    super(message);
    this.name = "LockfileError";
    this.code = code;
    this.fix = fix;
  }
}
