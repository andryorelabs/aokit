import { join } from "node:path";
import { buildPackage } from "./build.ts";

const repoRoot = join(import.meta.dir, "..", "..");

await buildPackage(join(repoRoot, "packages", "aokit"), join(repoRoot, "registry"));
