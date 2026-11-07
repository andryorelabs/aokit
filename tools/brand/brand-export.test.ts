import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, cp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exportBrand } from "./brand-export.ts";
import {
  assertSpec,
  encodeIco,
  readIcoSizes,
  readPngColourType,
  readPngSize,
  rasterSpecs,
  type RasterSpec,
} from "./brand-export-spec.ts";

const BRAND_DIR = new URL("../../docs/brand/", import.meta.url);
const TRUECOLOUR_ALPHA = 6;

function readBrand(path: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(path, BRAND_DIR)));
}

function requireSpec(spec: RasterSpec | undefined): RasterSpec {
  if (spec === undefined) {
    throw new Error("missing raster spec");
  }
  return spec;
}

const markSpecs = rasterSpecs.filter((spec) => spec.path.endsWith(".png"));
const icoSpec = requireSpec(rasterSpecs.find((spec) => spec.path.endsWith(".ico")));

describe("committed rasters", () => {
  test.each(rasterSpecs.map((spec) => [spec.path, spec] as const))(
    "%s meets its spec",
    (_path, spec) => {
      expect(() => assertSpec(spec, readBrand(spec.path))).not.toThrow();
    },
  );

  test.each(markSpecs.map((spec) => [spec.path, spec] as const))(
    "%s has exact dimensions and alpha",
    (_path, spec) => {
      const bytes = readBrand(spec.path);
      expect(readPngSize(bytes)).toEqual({ width: spec.width, height: spec.height });
      expect(readPngColourType(bytes)).toBe(TRUECOLOUR_ALPHA);
      expect(bytes.length).toBeLessThanOrEqual(spec.maxBytes);
    },
  );

  test("favicon.ico holds 16, 32 and 48 px entries", () => {
    const bytes = readBrand(icoSpec.path);
    expect(readIcoSizes(bytes)).toEqual([16, 32, 48]);
    expect(bytes.length).toBeLessThanOrEqual(icoSpec.maxBytes);
  });
});

describe("assertSpec", () => {
  const spec = requireSpec(markSpecs[0]);

  test("throws naming the file when dimensions differ", () => {
    const wrongSize = readBrand("logo/png/mark-32.png");
    expect(() => assertSpec(spec, wrongSize)).toThrow(/mark-16\.png: expected 16x16, got 32x32/);
  });

  test("throws when the byte budget is exceeded", () => {
    const bytes = readBrand(spec.path);
    expect(() => assertSpec({ ...spec, maxBytes: bytes.length - 1 }, bytes)).toThrow(/budget/);
  });

  test("throws when bytes are not a PNG or ICO", () => {
    expect(() => assertSpec(spec, new Uint8Array(40))).toThrow(/not a PNG/);
    expect(() => assertSpec(icoSpec, new Uint8Array(40))).toThrow(/not an ICO/);
  });

  test("throws when the ICO largest entry is wrong", () => {
    const small = encodeIco([{ size: 16, png: readBrand("logo/png/mark-16.png") }]);
    expect(() => assertSpec(icoSpec, small)).toThrow(/expected 48x48, got 16x16/);
  });
});

describe("encodeIco", () => {
  test("round-trips entry sizes and embeds the PNG bytes", () => {
    const png = readBrand("logo/png/mark-16.png");
    const ico = encodeIco([
      { size: 16, png },
      { size: 256, png },
    ]);
    expect(readIcoSizes(ico)).toEqual([16, 256]);
    expect(ico.length).toBe(6 + 2 * 16 + png.length * 2);
  });

  test("reads nothing from truncated or foreign bytes", () => {
    expect(readIcoSizes(new Uint8Array(3))).toEqual([]);
    expect(readIcoSizes(new Uint8Array([1, 0, 1, 0, 1, 0]))).toEqual([]);
    expect(readIcoSizes(new Uint8Array([0, 0, 1, 0, 2, 0]))).toEqual([]);
  });
});

describe("exportBrand", () => {
  test("regenerates the committed bytes into a scratch root", async () => {
    const root = await mkdtemp(join(tmpdir(), "brand-export-"));
    try {
      await cp(new URL("logo/mark.svg", BRAND_DIR), join(root, "docs/brand/logo/mark.svg"), {
        recursive: true,
      });
      await exportBrand({ root });
      const written = await Promise.all(
        rasterSpecs.map((spec) => readFile(join(root, "docs/brand", spec.path))),
      );
      written.forEach((bytes, index) => {
        const spec = requireSpec(rasterSpecs[index]);
        expect(bytes.equals(Buffer.from(readBrand(spec.path)))).toBe(true);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails when mark.svg is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "brand-export-"));
    const outcome = await exportBrand({ root }).then(
      () => "resolved",
      () => "rejected",
    );
    await rm(root, { recursive: true, force: true });
    expect(outcome).toBe("rejected");
  });
});
