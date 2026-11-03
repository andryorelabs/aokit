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
  if (noColorFlag || (env.NO_COLOR ?? "") !== "") {
    return false;
  }
  if ((env.FORCE_COLOR ?? "") !== "" && env.FORCE_COLOR !== "0") {
    return true;
  }
  if (env.TERM === "dumb") {
    return false;
  }
  return isTTY;
}
