import { AokitError } from "../cli/envelope.ts";
import { registerShutdownHook } from "../cli/shutdown.ts";

function installFailure(directory: string, detail: string): AokitError {
  return new AokitError(
    "IO_ERROR",
    `the Project was created in \`${directory}\` but \`bun install\` failed${detail === "" ? "" : `: ${detail}`}`,
    `run \`bun install\` in \`${directory}\` to finish the setup`,
  );
}

/** Runs `bun install` in the Project; a failure is an exit-5 error that says how to finish. */
export async function runInstall(
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  let child;
  try {
    child = Bun.spawn(["bun", "install"], {
      cwd: directory,
      env: { ...env },
      stdout: "ignore",
      stderr: "pipe",
    });
  } catch (error) {
    throw installFailure(directory, error instanceof Error ? error.message : String(error));
  }
  const unregister = registerShutdownHook(() => {
    child.kill();
  });
  try {
    const [stderrText, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      const tail = stderrText.trim().split("\n").slice(-5).join("\n");
      throw installFailure(directory, `exit code ${exitCode}${tail === "" ? "" : `\n${tail}`}`);
    }
  } finally {
    unregister();
  }
}
