import { runCli } from "./adapter.ts";
import { exposedCommands, hiddenCommands } from "./commands/registry.ts";
import type { ExitCode } from "./exit-codes.ts";
import { installSignalHandlers } from "./shutdown.ts";
import { cliVersion } from "./version.ts";

/** Runs the aokit CLI in-process with `argv` (without the executable and script) and returns its exit code. */
export async function run(argv: string[]): Promise<ExitCode> {
  installSignalHandlers();
  return runCli({
    argv,
    commands: exposedCommands,
    hiddenCommands,
    env: process.env,
    version: cliVersion,
    updateNotice: false,
    io: {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      isTTY: process.stdout.isTTY,
      isStderrTTY: process.stderr.isTTY,
    },
  });
}
