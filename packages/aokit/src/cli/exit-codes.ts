/** Exit codes a command run can produce. `2` is the `UPDATE_AVAILABLE` outcome of `check` and `REGISTRY_ENV_UNSET`. */
export const exitCodes = {
  success: 0,
  failure: 1,
  outcome: 2,
  usage: 3,
  resolution: 4,
  precondition: 5,
  mergeConflicts: 6,
  interrupted: 130,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

/** Every stable error code mapped to exactly one exit-code category. */
export const errorCodeExitCodes = {
  INVALID_INPUT: exitCodes.usage,
  MISSING_VALUE: exitCodes.usage,
  UNKNOWN_FLAG: exitCodes.usage,
  UNKNOWN_COMMAND: exitCodes.usage,
  INVALID_CONFIG: exitCodes.usage,
  CAPABILITY_CONFLICT: exitCodes.resolution,
  REQUIREMENT_UNMET: exitCodes.resolution,
  MODULE_UNKNOWN: exitCodes.resolution,
  CARDINALITY_EXCEEDED: exitCodes.resolution,
  DIRTY_TREE: exitCodes.precondition,
  LOCKFILE_MISSING: exitCodes.precondition,
  PLAN_REQUIRED: exitCodes.precondition,
  MIN_CLI_VERSION: exitCodes.precondition,
  MERGE_CONFLICTS: exitCodes.mergeConflicts,
  INTERRUPTED: exitCodes.interrupted,
  UPDATE_AVAILABLE: exitCodes.outcome,
  DRIFT: exitCodes.failure,
  NOT_IN_LOCKFILE: exitCodes.usage,
  MODULE_VERSION_UNAVAILABLE: exitCodes.failure,
  DEPENDENTS_EXIST: exitCodes.resolution,
  NOT_SELECTED: exitCodes.usage,
  IO_ERROR: exitCodes.failure,
  INTERNAL: exitCodes.failure,
  MIGRATION_FAILED: exitCodes.failure,
  PLAN_STALE: exitCodes.precondition,
  PLAN_MISSING: exitCodes.precondition,
  REGISTRY_UNTRUSTED: exitCodes.precondition,
  REGISTRY_FETCH_FAILED: exitCodes.failure,
  REGISTRY_INTEGRITY_MISMATCH: exitCodes.failure,
  REGISTRY_ENV_UNSET: exitCodes.outcome,
  REGISTRY_ITEM_UNSUPPORTED: exitCodes.failure,
  REGISTRY_ITEM_CHANGED: exitCodes.failure,
} as const satisfies Record<string, ExitCode>;

export type ErrorCode = keyof typeof errorCodeExitCodes;

function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(errorCodeExitCodes, code);
}

/**
 * Maps an error code to its exit code. Codes outside the table are treated as
 * unexpected failures (`1`).
 */
export function exitCodeForErrorCode(code: string): ExitCode {
  return isErrorCode(code) ? errorCodeExitCodes[code] : exitCodes.failure;
}
