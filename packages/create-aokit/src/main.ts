#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const aokitCliPath = fileURLToPath(new URL("./cli.js", import.meta.resolve("aokit/cli")));

/**
 * Signals this shim passes on to the aokit child. SIGINT is not passed on: a terminal
 * delivers it to the whole foreground process group, so the child already has it.
 */
const forwardedSignals = ["SIGTERM", "SIGHUP"] as const;

const child = spawn("bun", [aokitCliPath, "create", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, AOKIT_NO_UPDATE_NOTIFIER: "1" },
});

let spawnFailed = false;

for (const signal of forwardedSignals) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
process.on("SIGINT", () => {});

child.on("error", (error) => {
  spawnFailed = true;
  process.stderr.write(`create-aokit needs Bun (>=1.4.4) on PATH to run aokit: ${error.message}\n`);
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
