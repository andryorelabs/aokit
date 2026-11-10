import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/**
 * The environment variables the XDG helpers read.
 */
type XdgEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Where one aokit directory lives: the XDG variable that wins everywhere, the Windows variable
 * used next on win32, and the home-relative fallbacks for each platform family.
 */
interface DirectoryRule {
  xdgVariable: string;
  windowsVariable: string;
  windowsFallback: readonly string[];
  posixFallback: string;
}

const configRule: DirectoryRule = {
  xdgVariable: "XDG_CONFIG_HOME",
  windowsVariable: "APPDATA",
  windowsFallback: ["AppData", "Roaming"],
  posixFallback: ".config",
};

const cacheRule: DirectoryRule = {
  xdgVariable: "XDG_CACHE_HOME",
  windowsVariable: "LOCALAPPDATA",
  windowsFallback: ["AppData", "Local"],
  posixFallback: ".cache",
};

function absoluteVariable(
  env: XdgEnvironment,
  variable: string,
  path: typeof posix,
): string | undefined {
  const value = env[variable];
  return value !== undefined && value !== "" && path.isAbsolute(value) ? value : undefined;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  return values.find((value) => value !== undefined && value !== "");
}

function aokitDirectory(
  env: XdgEnvironment,
  rule: DirectoryRule,
  platform: NodeJS.Platform,
): string {
  const path = platform === "win32" ? win32 : posix;
  const xdg = absoluteVariable(env, rule.xdgVariable, path);
  if (xdg !== undefined) return path.join(xdg, "aokit");
  if (platform === "win32") {
    const windows = absoluteVariable(env, rule.windowsVariable, path);
    if (windows !== undefined) return path.join(windows, "aokit");
    const profile = firstNonEmpty(env.USERPROFILE, env.HOME) ?? homedir();
    return path.join(profile, ...rule.windowsFallback, "aokit");
  }
  const home = firstNonEmpty(env.HOME) ?? homedir();
  return path.join(home, rule.posixFallback, "aokit");
}

/**
 * The aokit user configuration directory: `$XDG_CONFIG_HOME/aokit` when that variable is absolute
 * (the XDG spec ignores relative values). Otherwise `%APPDATA%\aokit` on win32 (falling back to
 * the profile's `AppData\Roaming`), and `~/.config/aokit` elsewhere.
 */
export function xdgConfigDir(
  env: XdgEnvironment,
  platform: NodeJS.Platform = process.platform,
): string {
  return aokitDirectory(env, configRule, platform);
}

/**
 * The aokit cache directory: `$XDG_CACHE_HOME/aokit` when that variable is absolute (the XDG spec
 * ignores relative values). Otherwise `%LOCALAPPDATA%\aokit` on win32 (falling back to the
 * profile's `AppData\Local`), and `~/.cache/aokit` elsewhere.
 */
export function xdgCacheDir(
  env: XdgEnvironment,
  platform: NodeJS.Platform = process.platform,
): string {
  return aokitDirectory(env, cacheRule, platform);
}
