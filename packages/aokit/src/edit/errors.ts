/** Stable error codes raised by the TS edit engine. */
export type EditErrorCode =
  | "edit.anchor-not-found"
  | "edit.overlap"
  | "edit.unknown-module"
  | "edit.out-of-range"
  | "edit.parse-failed"
  | "edit.config-shape";

/** Error raised by the edit engine; names the file and every Module involved. */
export class EditError extends Error {
  readonly code: EditErrorCode;
  readonly file: string;
  readonly modules: readonly string[];

  constructor(code: EditErrorCode, message: string, file: string, modules: readonly string[] = []) {
    super(message);
    this.name = "EditError";
    this.code = code;
    this.file = file;
    this.modules = modules;
  }
}
