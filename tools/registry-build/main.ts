import { join } from "node:path";
import { buildRegistry } from "./build.ts";

const repoRoot = join(import.meta.dir, "..", "..");

await buildRegistry(join(repoRoot, "registry-src"), join(repoRoot, "registry"));
