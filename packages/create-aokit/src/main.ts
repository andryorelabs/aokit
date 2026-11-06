#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const aokitCliPath = fileURLToPath(new URL("./cli.js", import.meta.resolve("aokit/cli")));

const child = spawnSync("bun", [aokitCliPath, "create", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (child.error !== undefined) {
  process.stderr.write(
    `create-aokit needs Bun (>=1.4.4) on PATH to run aokit: ${child.error.message}\n`,
  );
  process.exitCode = 1;
} else {
  process.exitCode = child.status ?? 1;
}
