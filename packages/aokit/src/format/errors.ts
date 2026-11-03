/** Stable error codes raised by the pinned format phase. */
export type FormatErrorCode =
  | "format.version-mismatch"
  | "format.catalog-missing-oxfmt"
  | "format.invalid-config"
  | "format.failed";

/** Failure of the pinned format phase; names the file or the versions involved. */
export class FormatError extends Error {
  readonly code: FormatErrorCode;
  readonly fix: string;

  constructor(code: FormatErrorCode, message: string, fix: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FormatError";
    this.code = code;
    this.fix = fix;
  }
}
