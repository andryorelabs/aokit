type RegistryErrorCode =
  | "REGISTRY_NOT_FOUND"
  | "REGISTRY_INDEX_INVALID"
  | "REGISTRY_SCHEMA_TOO_NEW"
  | "REGISTRY_CLI_TOO_OLD"
  | "REGISTRY_CATALOG_INVALID"
  | "REGISTRY_RELEASE_MISMATCH"
  | "REGISTRY_MANIFEST_INVALID"
  | "REGISTRY_SUMMARY_MISMATCH"
  | "REGISTRY_FILE_MISSING"
  | "REGISTRY_INTEGRITY_MISMATCH"
  | "REGISTRY_FETCH_FAILED"
  | "REGISTRY_UNTRUSTED"
  | "REGISTRY_PATH_UNSAFE"
  | "REGISTRY_MODULE_NOT_FOUND"
  | "REGISTRY_SOURCE_UNSUPPORTED"
  | "REGISTRY_ENV_UNSET"
  | "REGISTRY_ITEM_UNSUPPORTED"
  | "REGISTRY_ITEM_CHANGED"
  | "REGISTRY_EXTRACT_FAILED";

/**
 * Structured detail of a Registry failure, carried into the command envelope's `error.data`.
 */
export interface RegistryErrorData {
  /** The Registry name, or its source when the index was not read yet. */
  registry?: string;
  /** The Module, as `name@version`, when the failure concerns one. */
  module?: string;
  /** The path or URL that failed. */
  path?: string;
  /** The expected value, such as an integrity. */
  expected?: string;
  /** The actual value, such as an integrity. */
  actual?: string;
  /** The HTTP status of a failed fetch. */
  status?: number;
  /** The name of an environment variable a Namespace references, never its value. */
  variable?: string;
}

/**
 * Failure while reading or verifying a Registry. `message` names the Registry, the Module and the
 * expected versus actual value where there is one; `fix` tells the user what to do; `data` holds
 * the same facts as fields.
 */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly fix: string;
  readonly data: RegistryErrorData;

  constructor(code: RegistryErrorCode, message: string, fix: string, data: RegistryErrorData = {}) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.fix = fix;
    this.data = data;
  }
}
