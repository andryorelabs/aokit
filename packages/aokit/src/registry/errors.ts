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
  | "REGISTRY_INTEGRITY_MISMATCH";

/**
 * Failure while reading or verifying a Registry. `message` names the Registry, the Module and the
 * expected versus actual value where there is one; `fix` tells the user what to do.
 */
export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly fix: string;

  constructor(code: RegistryErrorCode, message: string, fix: string) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.fix = fix;
  }
}
