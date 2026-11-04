import { refreshLatestVersion } from "./index.ts";

/** The only argument of the hidden process that refreshes the cached latest CLI version. */
export const refreshArgument = "__refresh-update-check";

/**
 * Starts the CLI again in a detached process that refreshes the cache and exits, so the command
 * that asked for it never waits for the network.
 */
export function spawnDetachedRefresh(): void {
  try {
    const script = Bun.main.startsWith("/$bunfs") ? [] : [Bun.main];
    const child = Bun.spawn([process.execPath, ...script, refreshArgument], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: process.env,
    });
    child.unref();
  } catch {
    return;
  }
}

/** Entry of the detached process: refreshes the cache from the npm registry. */
export async function runDetachedRefresh(): Promise<void> {
  await refreshLatestVersion({ env: process.env, now: Date.now, fetch });
}
