import { describe, expect, test } from "bun:test";

import { contrastRatio, palette } from "./palette.ts";

describe("contrastRatio", () => {
  test("black on white is 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  test("identical colours give 1", () => {
    expect(contrastRatio("#0f0f0f", "#0f0f0f")).toBeCloseTo(1, 5);
  });

  test("is symmetric in its arguments", () => {
    expect(contrastRatio("#f2f2ee", "#0f0f0f")).toBeCloseTo(
      contrastRatio("#0f0f0f", "#f2f2ee"),
      10,
    );
  });

  test("rejects a malformed colour", () => {
    expect(() => contrastRatio("red", "#ffffff")).toThrow(/red/);
  });
});

describe("palette", () => {
  test("holds the Soot values verbatim", () => {
    expect(palette.dark).toEqual({
      bg: "#0f0f0f",
      surface: "#1a1a1a",
      border: "#2c2c2c",
      text: "#f2f2ee",
      muted: "#a3a3a0",
      mark: "#f2f2ee",
    });
    expect(palette.light).toEqual({
      bg: "#f5f5f3",
      surface: "#ffffff",
      border: "#d9d9d6",
      text: "#151515",
      muted: "#595957",
      mark: "#151515",
    });
  });
});
