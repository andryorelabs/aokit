import { join } from "node:path";

/** The Registry that ships with the running CLI, the target of the `"bundled"` source. */
export const bundledRegistryPath = join(import.meta.dir, "..", "..", "..", "..", "registry");
