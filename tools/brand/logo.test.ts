import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { palette } from "./palette.ts";

const SVG_FILES = [
  "mark.svg",
  "mark-white.svg",
  "lockup-horizontal.svg",
  "lockup-horizontal-dark.svg",
] as const;

const INK: Readonly<Record<(typeof SVG_FILES)[number], string>> = {
  "mark.svg": "#151515",
  "mark-white.svg": "#f2f2ee",
  "lockup-horizontal.svg": "#151515",
  "lockup-horizontal-dark.svg": "#f2f2ee",
};

const allowedColours = new Set(
  [...Object.values(palette.dark), ...Object.values(palette.light)].map((colour) =>
    colour.toLowerCase(),
  ),
);

function readSvg(file: string): string {
  return readFileSync(new URL(`../../docs/brand/logo/${file}`, import.meta.url), "utf8");
}

describe("brand SVGs", () => {
  for (const file of SVG_FILES) {
    describe(file, () => {
      const svg = readSvg(file);

      test("uses only palette colours", () => {
        const colours = [...svg.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) =>
          match[0].toLowerCase(),
        );
        expect(colours.length).toBeGreaterThan(0);
        const outside = colours.filter((colour) => !allowedColours.has(colour));
        expect(outside, `${file} uses colours outside the palette`).toEqual([]);
      });

      test("uses a single ink colour", () => {
        const colours = new Set([...svg.matchAll(/fill="([^"]+)"/g)].map((match) => match[1]));
        expect([...colours]).toEqual([INK[file]]);
      });

      test("is an accessible image named aokit", () => {
        expect(svg).toContain('role="img"');
        expect(svg).toContain('aria-label="aokit"');
      });

      test("carries no text, script or external reference", () => {
        expect(svg).not.toMatch(/<text|<script|<image|href=|url\(/);
      });
    });
  }

  test("the mark is four rounded 11x11 squares on a 32 grid", () => {
    for (const file of ["mark.svg", "mark-white.svg"]) {
      const svg = readSvg(file);
      expect(svg).toContain('viewBox="0 0 32 32"');
      const rects = [...svg.matchAll(/<rect [^>]*>/g)].map((match) => match[0]);
      expect(rects).toHaveLength(4);
      for (const rect of rects) {
        expect(rect).toContain('width="11" height="11" rx="3"');
      }
      expect(rects.filter((rect) => rect.includes('fill-opacity="0.42"'))).toHaveLength(3);
      expect(rects[0]).toContain('x="4" y="4"');
      expect(rects[1]).toContain('x="17" y="4"');
      expect(rects[2]).toContain('x="4" y="17"');
      expect(rects[3]).toContain('x="18.5" y="18.5"');
      expect(rects[3]).not.toContain("fill-opacity");
    }
  });

  test("the lockup word is outlined to paths", () => {
    for (const file of ["lockup-horizontal.svg", "lockup-horizontal-dark.svg"]) {
      expect(readSvg(file)).toMatch(/<path [^>]*d="M/);
    }
  });
});
