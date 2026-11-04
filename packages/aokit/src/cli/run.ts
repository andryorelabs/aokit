import { runCli } from "./adapter.ts";
import { exposedCommands, hiddenCommands } from "./commands/registry.ts";
import type { ExitCode } from "./exit-codes.ts";
import { cliVersion } from "./version.ts";

/** Runs the aokit CLI in-process with `argv` (without the executable and script) and returns its exit code. */
export async function run(argv: string[]): Promise<ExitCode> {
  return runCli({
    argv,
    commands: exposedCommands,
    hiddenCommands,
    env: process.env,
    version: cliVersion,
    io: {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      isTTY: process.stdout.isTTY,
    },
  });
}
