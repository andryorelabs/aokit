/** Banner printed before the root help on a color terminal; mirrors `docs/brand/terminal/banner.ansi`. */
export const bannerAnsi =
  "\u001B[90m██ ██\u001B[0m   \u001B[1;97maokit\u001B[0m  Projects from Modules. Updates that merge.\n" +
  "\u001B[90m██\u001B[0m \u001B[97m██\u001B[0m   \u001B[90mbunx aokit create my-app\u001B[0m\n";

/** Banner printed before the root help without color; mirrors `docs/brand/terminal/banner.txt`. */
export const bannerPlain =
  "██ ██   aokit  Projects from Modules. Updates that merge.\n██ ██   bunx aokit create my-app\n";

/** Returns the banner variant that matches the color decision. */
export function renderBanner({ color }: { color: boolean }): string {
  return color ? bannerAnsi : bannerPlain;
}
