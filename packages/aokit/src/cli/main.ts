#!/usr/bin/env bun

import { run } from "./run.ts";
import { installSignalHandlers } from "./shutdown.ts";

installSignalHandlers();

const argv = process.argv.slice(2);

if (argv.length === 1 && argv[0] === "mcp") {
  const { startMcpServer } = await import("../mcp/server.ts");
  await startMcpServer();
} else {
  process.exitCode = await run(argv);
}
