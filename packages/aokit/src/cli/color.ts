import { readForceColor, readIsDumbTerminal, readNoColor } from "../env.ts";

interface ColorEnvironment {
  env: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  noColorFlag: boolean;
}

/**
 * Decides whether output may use color. `NO_COLOR`, `--no-color`, `TERM=dumb`
 * and non-TTY streams disable it; `FORCE_COLOR` wins over TTY detection but
 * never over `NO_COLOR`.
 */
export function isColorEnabled({ env, isTTY, noColorFlag }: ColorEnvironment): boolean {
  if (noColorFlag || readNoColor(env)) {
    return false;
  }
  if (readForceColor(env)) {
    return true;
  }
  if (readIsDumbTerminal(env)) {
    return false;
  }
  return isTTY;
}
