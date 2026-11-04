import { join } from "node:path";

declare const AOKIT_BUNDLED_REGISTRY_RELATIVE: string | undefined;

function resolveBundledRegistryPath(): string {
  if (typeof AOKIT_BUNDLED_REGISTRY_RELATIVE === "string") {
    return join(import.meta.dir, AOKIT_BUNDLED_REGISTRY_RELATIVE);
  }
  return join(import.meta.dir, "..", "..", "..", "..", "registry");
}

/** The Registry that ships with the running CLI, the target of the `"bundled"` source. */
export const bundledRegistryPath = resolveBundledRegistryPath();
