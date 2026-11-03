#!/usr/bin/env bun

import { runCli } from "./adapter.ts";
import { exposedCommands } from "./commands/registry.ts";
import { installSignalHandlers } from "./shutdown.ts";
import { cliVersion } from "./version.ts";

installSignalHandlers();

process.exitCode = await runCli({
  argv: process.argv.slice(2),
  commands: exposedCommands,
  env: process.env,
  version: cliVersion,
  io: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    isTTY: process.stdout.isTTY,
  },
});
