#!/usr/bin/env bun

import { run } from "./run.ts";
import { installSignalHandlers } from "./shutdown.ts";
import { refreshArgument, runDetachedRefresh } from "./update-notice/spawn.ts";

const argv = process.argv.slice(2);

if (argv.length === 1 && argv[0] === refreshArgument) {
  await runDetachedRefresh();
} else if (argv.length === 1 && argv[0] === "mcp") {
  installSignalHandlers();
  const { startMcpServer } = await import("../mcp/server.ts");
  await startMcpServer();
} else {
  process.exitCode = await run(argv);
}
