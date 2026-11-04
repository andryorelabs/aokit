import { join } from "node:path";
import { extractBundledRegistry, hasEmbeddedRegistry } from "./embedded/extract.ts";

declare const AOKIT_BUNDLED_REGISTRY_RELATIVE: string | undefined;

async function resolveBundledRegistryPath(): Promise<string> {
  if (hasEmbeddedRegistry()) {
    return extractBundledRegistry(process.env);
  }
  if (typeof AOKIT_BUNDLED_REGISTRY_RELATIVE === "string") {
    return join(import.meta.dir, AOKIT_BUNDLED_REGISTRY_RELATIVE);
  }
  return join(import.meta.dir, "..", "..", "..", "..", "registry");
}

/** The Registry that ships with the running CLI, the target of the `"bundled"` source. */
export const bundledRegistryPath = await resolveBundledRegistryPath();
