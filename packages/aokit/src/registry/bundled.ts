import { join } from "node:path";
import {
  embeddedRegistryTarget,
  extractBundledRegistry,
  hasEmbeddedRegistry,
} from "./embedded/extract.ts";

declare const AOKIT_BUNDLED_REGISTRY_RELATIVE: string | undefined;

async function resolveEmbeddedRegistryPath(): Promise<string> {
  try {
    return await extractBundledRegistry(process.env);
  } catch {
    return embeddedRegistryTarget(process.env);
  }
}

async function resolveBundledRegistryPath(): Promise<string> {
  if (hasEmbeddedRegistry()) {
    return resolveEmbeddedRegistryPath();
  }
  if (typeof AOKIT_BUNDLED_REGISTRY_RELATIVE === "string") {
    return join(import.meta.dir, AOKIT_BUNDLED_REGISTRY_RELATIVE);
  }
  return join(import.meta.dir, "..", "..", "..", "..", "registry");
}

/**
 * The Registry that ships with the running CLI, the target of the `"bundled"` source. In the binary
 * an extraction failure (an unwritable cache directory) does not abort startup: the path still
 * names the intended directory, and only a command that reads the bundled Registry fails.
 */
export const bundledRegistryPath = await resolveBundledRegistryPath();
