/**
 * The Soot palette, one entry per grade. `docs/brand/tokens.css` must carry
 * exactly these values and every brand SVG may use only these colours.
 */
export const palette: Readonly<
  Record<
    "dark" | "light",
    Readonly<Record<"bg" | "surface" | "border" | "text" | "muted" | "mark", string>>
  >
> = {
  dark: {
    bg: "#0f0f0f",
    surface: "#1a1a1a",
    border: "#2c2c2c",
    text: "#f2f2ee",
    muted: "#a3a3a0",
    mark: "#f2f2ee",
  },
  light: {
    bg: "#f5f5f3",
    surface: "#ffffff",
    border: "#d9d9d6",
    text: "#151515",
    muted: "#595957",
    mark: "#151515",
  },
};

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/**
 * Relative luminance of a `#rrggbb` colour as defined by WCAG 2.x.
 *
 * @throws when the colour is not a six-digit hex string.
 */
function relativeLuminance(colour: string): number {
  if (!HEX_COLOUR.test(colour)) {
    throw new Error(`Expected a #rrggbb colour, got "${colour}"`);
  }
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(colour.slice(start, start + 2), 16) / 255;
    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * WCAG 2.x contrast ratio between two `#rrggbb` colours, from 1 to 21.
 * Symmetric: the lighter colour is always the numerator.
 */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
