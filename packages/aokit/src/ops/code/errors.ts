/** Stable error codes raised by the code Ops. */
type CodeOpErrorCode =
  | "ops.extension-point-missing"
  | "ops.extension-point-range"
  | "ops.extension-point-target"
  | "ops.extension-point-kind"
  | "ops.anchor-file"
  | "ops.key-conflict"
  | "ops.invalid-op";

/** Error raised by a code Op; names the Module and the Extension point. */
export class CodeOpError extends Error {
  readonly code: CodeOpErrorCode;
  readonly module: string;

  constructor(code: CodeOpErrorCode, message: string, module: string) {
    super(message);
    this.name = "CodeOpError";
    this.code = code;
    this.module = module;
  }
}
