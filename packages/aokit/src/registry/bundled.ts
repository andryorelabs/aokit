import { join } from "node:path";
import { embeddedRegistryTarget, hasEmbeddedRegistry } from "./embedded/extract.ts";

declare const AOKIT_BUNDLED_REGISTRY_RELATIVE: string | undefined;

function resolveBundledRegistryPath(): string {
  if (hasEmbeddedRegistry()) {
    return embeddedRegistryTarget(process.env);
  }
  if (typeof AOKIT_BUNDLED_REGISTRY_RELATIVE === "string") {
    return join(import.meta.dir, AOKIT_BUNDLED_REGISTRY_RELATIVE);
  }
  return join(import.meta.dir, "..", "..", "..", "..", "registry");
}

/**
 * The Registry that ships with the running CLI, the target of the `"bundled"` source. In the binary
 * this is the directory the embedded Registry is extracted to; the extraction itself runs lazily,
 * when the Registry client opens the `"bundled"` source.
 */
export const bundledRegistryPath = resolveBundledRegistryPath();
