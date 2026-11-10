import type { ModuleManifest } from "@aokit/module";

/**
 * Stable machine-readable identifier of a resolution failure.
 */
type ResolveErrorCode =
  | "unknown_module"
  | "requirement_unmet"
  | "requirement_ambiguous"
  | "extension_point_unmet"
  | "cardinality_exceeded"
  | "module_conflict"
  | "dependency_cycle";

/**
 * A coded, actionable resolution failure: what failed, why, and the fix.
 */
export interface ResolveError {
  readonly code: ResolveErrorCode;
  readonly message: string;
  readonly fix: string;
  readonly module?: string;
  readonly capability?: string;
  readonly providers?: readonly string[];
}

/**
 * Stable machine-readable identifier of a non-fatal finding.
 */
type ResolveWarningCode = "cardinality_disagreement" | "override_inert";

/**
 * A non-fatal finding the caller should surface.
 */
export interface ResolveWarning {
  readonly code: ResolveWarningCode;
  readonly message: string;
  readonly module?: string;
  readonly capability?: string;
}

/**
 * A missing requirement with exactly one provider; applied only with `acceptSuggestions`.
 */
export interface ResolveSuggestion {
  readonly module: string;
  readonly requiredBy: string;
  readonly requirement: string;
  readonly applied: boolean;
}

/**
 * Where a resolved Module came from.
 */
export type ResolvedModuleSource = "selected" | "locked" | "suggested";

/**
 * A Module in the canonical resolved order.
 */
export interface ResolvedModule {
  readonly name: string;
  readonly manifest: ModuleManifest;
  readonly source: ResolvedModuleSource;
}

/**
 * The Modules the user picked plus those already recorded in the Lockfile.
 */
export interface ResolveSelection {
  readonly modules: readonly string[];
  readonly locked?: readonly string[];
}

/**
 * The command a resolution serves; it decides how an error's fix is worded.
 */
export type ResolveIntent = "create" | "add";

/**
 * Resolver behaviour switches.
 */
export interface ResolveOptions {
  readonly intent?: ResolveIntent;
  readonly acceptSuggestions?: boolean;
}

/**
 * Successful resolution: Modules in canonical order.
 */
export interface ResolveSuccess {
  readonly ok: true;
  readonly modules: readonly ResolvedModule[];
  readonly warnings: readonly ResolveWarning[];
  readonly suggestions: readonly ResolveSuggestion[];
}

/**
 * Failed resolution; warnings and suggestions found so far are still returned.
 */
export interface ResolveFailure {
  readonly ok: false;
  readonly error: ResolveError;
  readonly warnings: readonly ResolveWarning[];
  readonly suggestions: readonly ResolveSuggestion[];
}

/**
 * Outcome of `resolve`.
 */
export type ResolveResult = ResolveSuccess | ResolveFailure;
