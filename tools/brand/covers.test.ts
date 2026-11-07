import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  assertSpec,
  COVER_SPECS,
  rasterSpecs,
  readPngSize,
  type RasterSpec,
} from "./brand-export-spec.ts";

const BRAND_DIR = new URL("../../docs/brand/", import.meta.url);
const ONE_MEGABYTE = 1024 * 1024;

function readBrand(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(path, BRAND_DIR)));
}

function specFor(path: string): RasterSpec {
  const spec = rasterSpecs.find((candidate) => candidate.path === path);
  if (spec === undefined) {
    throw new Error(`missing raster spec for ${path}`);
  }
  return spec;
}

describe("covers and social previews", () => {
  test("the spec lists the four PNGs at their sizes", () => {
    expect(COVER_SPECS.map((cover) => [cover.name, cover.width, cover.height])).toEqual([
      ["cover", 1280, 440],
      ["cover-light", 1280, 440],
      ["social-preview", 1280, 640],
      ["social-preview-light", 1280, 640],
    ]);
  });

  test.each(COVER_SPECS.map((cover) => [cover.name, cover] as const))(
    "og/%s.png has exact dimensions and fits 1 MB",
    (name, cover) => {
      const bytes = readBrand(`og/${name}.png`);
      const spec = specFor(`og/${name}.png`);
      expect(readPngSize(bytes)).toEqual({ width: cover.width, height: cover.height });
      expect(bytes.length).toBeLessThanOrEqual(ONE_MEGABYTE);
      expect(spec.maxBytes).toBe(ONE_MEGABYTE);
      expect(() => assertSpec(spec, bytes)).not.toThrow();
    },
  );

  test("assertSpec rejects a cover with the wrong size", () => {
    const wrong = readBrand("og/social-preview.png");
    expect(() => assertSpec(specFor("og/cover.png"), wrong)).toThrow(/og\/cover\.png: expected/);
  });

  test.each(COVER_SPECS.map((cover) => [cover.name] as const))(
    "og/%s.html carries the approved copy and only token colours",
    (name) => {
      const html = new TextDecoder().decode(readBrand(`og/${name}.html`));
      expect(html).toContain("Projects from Modules. Updates that merge.");
      expect(html).toContain(
        "A Bun-only CLI that creates TypeScript projects from composable Modules.",
      );
      expect(html).toContain("bunx aokit create my-app");
      expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
      expect(html).not.toMatch(/https?:\/\//);
    },
  );
});
