import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { contrastRatio, palette } from "./palette.ts";

const tokensCss = readFileSync(new URL("../../docs/brand/tokens.css", import.meta.url), "utf8");

type Grade = keyof typeof palette;
type Token = keyof (typeof palette)[Grade];

const GRADE_SELECTORS: Readonly<Record<Grade, RegExp>> = {
  dark: /:root\s*\{([^}]*)\}/,
  light: /\.light\s*\{([^}]*)\}/,
};

const MEDIA_LIGHT = /@media \(prefers-color-scheme: light\)\s*\{[^{]*\{([^}]*)\}/;

function readDeclarations(block: string | undefined): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const match of (block ?? "").matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      declarations[name] = value.trim();
    }
  }
  return declarations;
}

const MINIMUM_CONTRAST: ReadonlyArray<readonly [Token, number]> = [
  ["text", 7],
  ["muted", 4.5],
  ["mark", 3],
];

describe("tokens.css", () => {
  for (const grade of ["dark", "light"] as const) {
    const declared = readDeclarations(GRADE_SELECTORS[grade].exec(tokensCss)?.[1]);

    test(`${grade} grade carries the palette verbatim`, () => {
      for (const [token, value] of Object.entries(palette[grade])) {
        expect(declared[token]).toBe(value);
      }
    });

    for (const [token, minimum] of MINIMUM_CONTRAST) {
      test(`${grade} ${token} on bg is at least ${minimum}:1`, () => {
        const ratio = contrastRatio(declared[token] ?? "", declared["bg"] ?? "");
        expect(
          ratio,
          `${grade} ${token} on bg is ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
        ).toBeGreaterThanOrEqual(minimum);
      });
    }
  }

  test("the prefers-color-scheme light block repeats the light grade", () => {
    expect(readDeclarations(MEDIA_LIGHT.exec(tokensCss)?.[1])).toEqual(
      readDeclarations(GRADE_SELECTORS.light.exec(tokensCss)?.[1]),
    );
  });

  test("declares the font families", () => {
    const declared = readDeclarations(GRADE_SELECTORS.dark.exec(tokensCss)?.[1]);
    expect(declared["font-sans"]).toBe('"Geist"');
    expect(declared["font-mono"]).toBe('"Geist Mono"');
  });
});
