type ApplyErrorCode = "INTERRUPTED" | "IO_ERROR";

/**
 * Failure while applying a Plan. The Project is unchanged and the temporary directory is removed
 * whenever the failure happened before the final rename.
 */
export class ApplyError extends Error {
  readonly code: ApplyErrorCode;
  readonly fix: string;

  constructor(code: ApplyErrorCode, message: string, fix: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ApplyError";
    this.code = code;
    this.fix = fix;
  }
}
