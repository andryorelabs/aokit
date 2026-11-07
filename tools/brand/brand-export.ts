import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

import {
  assertSpec,
  encodeIco,
  ICO_SIZES,
  MARK_SIZES,
  rasterSpecs,
  type RasterSpec,
} from "./brand-export-spec.ts";

const MARK_VIEWBOX = 32;
const SVG_BASE_DENSITY = 72;

async function renderMark(svg: Uint8Array, size: number): Promise<Uint8Array> {
  const density = (SVG_BASE_DENSITY * size) / MARK_VIEWBOX;
  return new Uint8Array(
    await sharp(svg, { density })
      .resize(size, size)
      .ensureAlpha()
      .png({ compressionLevel: 9, palette: false })
      .toBuffer(),
  );
}

function specFor(path: string): RasterSpec {
  const spec = rasterSpecs.find((candidate) => candidate.path === path);
  if (spec === undefined) {
    throw new Error(`No raster spec for ${path}`);
  }
  return spec;
}

/** Validates against the spec, then writes through a temp file and rename. */
async function writeValidated(brandDir: string, path: string, bytes: Uint8Array): Promise<void> {
  assertSpec(specFor(path), bytes);
  const target = join(brandDir, path);
  const temp = `${target}.tmp-${process.pid}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(temp, bytes);
  await rename(temp, target);
}

/** Regenerates the mark PNGs and `favicon.ico` under `<root>/docs/brand/`. */
export async function exportBrand(options: { root: string }): Promise<void> {
  const brandDir = join(options.root, "docs", "brand");
  const svg = new Uint8Array(await readFile(join(brandDir, "logo", "mark.svg")));
  const sizes = [...new Set([...MARK_SIZES, ...ICO_SIZES])];
  const pngs = new Map(
    await Promise.all(
      sizes.map(async (size): Promise<[number, Uint8Array]> => [size, await renderMark(svg, size)]),
    ),
  );
  const pngFor = (size: number): Uint8Array => {
    const png = pngs.get(size);
    if (png === undefined) {
      throw new Error(`Missing render for ${size}px`);
    }
    return png;
  };
  const pending: [string, Uint8Array][] = [
    ...MARK_SIZES.map((size): [string, Uint8Array] => [`logo/png/mark-${size}.png`, pngFor(size)]),
    ["logo/png/favicon.ico", encodeIco(ICO_SIZES.map((size) => ({ size, png: pngFor(size) })))],
  ];
  for (const [path, bytes] of pending) {
    assertSpec(specFor(path), bytes);
  }
  await Promise.all(pending.map(([path, bytes]) => writeValidated(brandDir, path, bytes)));
}

if (import.meta.main) {
  await exportBrand({ root: join(import.meta.dir, "..", "..") });
}
