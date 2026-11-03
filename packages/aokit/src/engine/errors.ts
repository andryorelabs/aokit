/** Stable error codes raised by the Engine. */
export type EngineErrorCode =
  | "engine.layout-unresolvable"
  | "engine.path-collision"
  | "engine.override-conflict"
  | "engine.unknown-op"
  | "engine.duplicate-op-handler"
  | "engine.invalid-path"
  | "engine.file-missing";

/** Error raised by the Engine; names every Module involved. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly modules: readonly string[];

  constructor(code: EngineErrorCode, message: string, modules: readonly string[] = []) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.modules = modules;
  }
}
