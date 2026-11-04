import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * The environment variables the XDG helpers read.
 */
type XdgEnvironment = Readonly<Record<string, string | undefined>>;

function baseDirectory(env: XdgEnvironment, variable: string, fallback: string): string {
  const value = env[variable];
  if (value !== undefined && value !== "" && isAbsolute(value)) {
    return value;
  }
  const home = env.HOME !== undefined && env.HOME !== "" ? env.HOME : homedir();
  return join(home, fallback);
}

/**
 * The aokit user configuration directory: `$XDG_CONFIG_HOME/aokit`, or `~/.config/aokit` when the
 * variable is unset, empty or relative (the XDG spec ignores relative values).
 */
export function xdgConfigDir(env: XdgEnvironment): string {
  return join(baseDirectory(env, "XDG_CONFIG_HOME", ".config"), "aokit");
}

/**
 * The aokit cache directory: `$XDG_CACHE_HOME/aokit`, or `~/.cache/aokit` when the variable is
 * unset, empty or relative (the XDG spec ignores relative values).
 */
export function xdgCacheDir(env: XdgEnvironment): string {
  return join(baseDirectory(env, "XDG_CACHE_HOME", ".cache"), "aokit");
}
