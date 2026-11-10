import type { ModuleManifestInput } from "./manifest.ts";

/**
 * Typed identity function: type-checks a Module declaration and returns it unchanged.
 */
export function defineModule<const Manifest extends ModuleManifestInput>(
  manifest: Manifest,
): Manifest {
  return manifest;
}
