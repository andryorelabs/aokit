import { join } from "node:path";

const cliEntry = join(import.meta.dir, "..", "..", "src", "cli", "main.ts");

export interface SpawnAokitOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}

export interface SpawnAokitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Command prefix that launches the CLI: the executable named by `AOKIT_BIN`
 * when set, otherwise the current Bun runtime running the source entry.
 */
export function aokitCommand(): string[] {
  const binaryPath = process.env["AOKIT_BIN"];
  if (binaryPath !== undefined && binaryPath !== "") return [binaryPath];
  return [process.execPath, cliEntry];
}

/** Runs the CLI to completion and captures its output. */
export async function spawnAokit(
  argv: string[],
  options: SpawnAokitOptions = {},
): Promise<SpawnAokitResult> {
  const child = Bun.spawn([...aokitCommand(), ...argv], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}
