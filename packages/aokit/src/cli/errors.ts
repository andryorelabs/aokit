import { AokitError } from "./envelope.ts";

/** The one message every Lockfile-requiring command shows outside an aokit Project. */
export const lockfileMissingMessage =
  "This directory is not an aokit Project (no Lockfile). Use `aokit create` to start a new one.";

const defaultLockfileMissingFix = "Run the command inside an aokit Project, or pass its directory.";

/** Builds the shared `LOCKFILE_MISSING` error; `fix` overrides the default hint. */
export function lockfileMissingError(fix: string = defaultLockfileMissingFix): AokitError {
  return new AokitError("LOCKFILE_MISSING", lockfileMissingMessage, fix);
}
