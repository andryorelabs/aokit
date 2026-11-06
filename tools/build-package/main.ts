import { join } from "node:path";
import { buildPackages } from "./build.ts";

await buildPackages(join(import.meta.dir, "..", ".."));
