import { resolve } from "node:path";
import { createGhRunner, runCheck } from "./check.ts";

/** Entry point of `bun run repo-settings:check`: a read-only drift check, run by hand. */
process.exitCode = runCheck({
  repoRoot: resolve(import.meta.dir, "../.."),
  repository: "andryorelabs/aokit",
  runGh: createGhRunner(),
  print: (line) => {
    console.log(line);
  },
});
