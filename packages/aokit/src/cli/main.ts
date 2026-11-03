#!/usr/bin/env bun

/**
 * Runs the aokit CLI and returns its process exit code. The command layer
 * replaces this placeholder once commands exist.
 */
function runAokitCli(): number {
  return 0;
}

process.exitCode = runAokitCli();
