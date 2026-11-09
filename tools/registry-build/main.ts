import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildRegistry } from "./build.ts";

const repoRoot = join(import.meta.dir, "..", "..");

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    "include-pending": { type: "boolean" },
  },
});

const output = values.out === undefined ? join(repoRoot, "registry") : resolve(values.out);

await buildRegistry(join(repoRoot, "registry-src"), output, {
  includePending: values["include-pending"] === true,
});
