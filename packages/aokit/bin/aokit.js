#!/usr/bin/env node
/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access -- plain JS outside every tsconfig, so type-aware linting has no Node types for it */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const aokitCliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

/**
 * Signals this shim passes on to the aokit child. SIGINT is not passed on: a terminal
 * delivers it to the whole foreground process group, so the child already has it.
 */
const forwardedSignals = ["SIGTERM", "SIGHUP"];

const child = spawn("bun", [aokitCliPath, ...process.argv.slice(2)], { stdio: "inherit" });

let spawnFailed = false;

for (const signal of forwardedSignals) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
process.on("SIGINT", () => {});

child.on("error", (error) => {
  spawnFailed = true;
  const reason = error.code === "ENOENT" ? "" : ` (${error.message})`;
  process.stderr.write(`aokit needs Bun (>=1.4.4) on PATH: https://bun.sh${reason}\n`);
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (spawnFailed) {
    return;
  }
  if (signal !== null) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
