/**
 * The environment the aokit child runs with: the live process environment with the update notice
 * switched off (`AOKIT_NO_UPDATE_NOTIFIER=1`), because `create` is a one-shot command. A source
 * file in this package reads or writes the environment only through this module.
 */
export function childEnvironment(): Record<string, string | undefined> {
  return { ...process.env, AOKIT_NO_UPDATE_NOTIFIER: "1" };
}
