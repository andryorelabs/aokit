/** Exit codes a command run can produce. `2` is reserved for `check` and is never produced here. */
export const exitCodes = {
  success: 0,
  failure: 1,
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
  CAPABILITY_CONFLICT: exitCodes.resolution,
  REQUIREMENT_UNMET: exitCodes.resolution,
  CARDINALITY_EXCEEDED: exitCodes.resolution,
  DIRTY_TREE: exitCodes.precondition,
  LOCKFILE_MISSING: exitCodes.precondition,
  PLAN_REQUIRED: exitCodes.precondition,
  MIN_CLI_VERSION: exitCodes.precondition,
  MERGE_CONFLICTS: exitCodes.mergeConflicts,
  INTERRUPTED: exitCodes.interrupted,
  IO_ERROR: exitCodes.failure,
  INTERNAL: exitCodes.failure,
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
