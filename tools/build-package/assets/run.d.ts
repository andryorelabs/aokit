/** Options of {@link run}. */
export interface RunOptions {
  /** Whether the update notice may run; true by default. */
  readonly updateNotice?: boolean;
}

/** Exit codes a command run can produce. */
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 130;

/** Runs the aokit CLI in-process with `argv` (without the executable and script) and returns its exit code. */
export function run(argv: string[], options?: RunOptions): Promise<ExitCode>;
