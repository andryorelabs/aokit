import { runCli, type RunCliOptions } from "./adapter.ts";
import { exposedCommands, hiddenCommands } from "./commands/registry.ts";
import type { ExitCode } from "./exit-codes.ts";
import { installSignalHandlers } from "./shutdown.ts";
import { cliVersion } from "./version.ts";

/** Options of {@link run}. */
export interface RunOptions {
  /** Whether the update notice may run; true by default. */
  readonly updateNotice?: boolean;
}

/** The {@link RunCliOptions} of the real process for `argv`. */
export function createRunOptions(argv: string[], options: RunOptions = {}): RunCliOptions {
  return {
    argv,
    commands: exposedCommands,
    hiddenCommands,
    env: process.env,
    version: cliVersion,
    updateNotice: options.updateNotice ?? true,
    io: {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      isTTY: process.stdout.isTTY,
      isStderrTTY: process.stderr.isTTY,
    },
  };
}

/** Runs the aokit CLI in-process with `argv` (without the executable and script) and returns its exit code. */
export async function run(argv: string[], options: RunOptions = {}): Promise<ExitCode> {
  installSignalHandlers();
  return runCli(createRunOptions(argv, options));
}
