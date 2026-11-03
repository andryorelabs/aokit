/** Stable error codes raised by the data Ops. */
type DataOpErrorCode =
  | "ops.extension-point-missing"
  | "ops.extension-point-range"
  | "ops.extension-point-kind"
  | "ops.extension-point-file"
  | "ops.json-pointer-missing"
  | "ops.json-pointer-type";

/** Error raised by a data Op; names the Module, the Extension point and its declared version. */
export class DataOpError extends Error {
  readonly code: DataOpErrorCode;
  readonly module: string;

  constructor(code: DataOpErrorCode, message: string, module: string) {
    super(message);
    this.name = "DataOpError";
    this.code = code;
    this.module = module;
  }
}
