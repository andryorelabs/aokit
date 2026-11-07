import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import sharp from "sharp";

import {
  assertSpec,
  COVER_SPECS,
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
export async function exportMarks(options: { root: string }): Promise<void> {
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

const REQUIRED_FONT_FAMILIES = ["Geist", "Geist Mono"] as const;

async function assertFontsLoaded(page: Page, name: string): Promise<void> {
  const result: unknown = await page.evaluate(`(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => face.family.replaceAll('"', ""));
  })()`);
  const loaded = Array.isArray(result) ? result : [];
  for (const family of REQUIRED_FONT_FAMILIES) {
    if (!loaded.includes(family)) {
      throw new Error(`${name}.html: font ${family} did not load`);
    }
  }
}

/**
 * Path of the newest Chromium in the Playwright browser cache, so the export
 * uses the host browser instead of downloading the build Playwright expects.
 * Returns `undefined` when none is cached and Playwright's own default applies.
 */
async function findCachedChromium(): Promise<string | undefined> {
  const cache =
    process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? join(homedir(), ".cache", "ms-playwright");
  const entries = await readdir(cache).catch(() => [] as string[]);
  const builds = entries
    .filter((entry) => /^chromium-\d+$/.test(entry))
    .toSorted((left, right) => Number(right.slice(9)) - Number(left.slice(9)));
  return builds
    .map((build) => join(cache, build, "chrome-linux64", "chrome"))
    .find((candidate) => existsSync(candidate));
}

/** Renders `og/<name>.html` to a PNG, failing on any request that is not a `file:` URL. */
async function renderCover(
  page: Page,
  brandDir: string,
  cover: (typeof COVER_SPECS)[number],
  blocked: string[],
): Promise<Uint8Array> {
  await page.setViewportSize({ width: cover.width, height: cover.height });
  await page.goto(pathToFileURL(join(brandDir, "og", `${cover.name}.html`)).href);
  if (blocked.length > 0) {
    throw new Error(`${cover.name}.html made non-file requests: ${blocked.join(", ")}`);
  }
  await assertFontsLoaded(page, cover.name);
  return new Uint8Array(await page.screenshot({ type: "png", animations: "disabled" }));
}

/** Renders the four cover and social preview PNGs offline with Chromium. */
export async function exportCovers(options: { root: string }): Promise<void> {
  const brandDir = join(options.root, "docs", "brand");
  const executablePath = await findCachedChromium();
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
  try {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      offline: true,
      reducedMotion: "reduce",
    });
    const blocked: string[] = [];
    await context.route(
      (url) => url.protocol !== "file:",
      async (route) => {
        blocked.push(route.request().url());
        await route.abort();
      },
    );
    const rendered = await Promise.all(
      COVER_SPECS.map(async (cover): Promise<[string, Uint8Array]> => {
        const page = await context.newPage();
        const bytes = await renderCover(page, brandDir, cover, blocked);
        return [`og/${cover.name}.png`, bytes];
      }),
    );
    for (const [path, bytes] of rendered) {
      assertSpec(specFor(path), bytes);
    }
    await Promise.all(rendered.map(([path, bytes]) => writeValidated(brandDir, path, bytes)));
  } finally {
    await browser.close();
  }
}

/** Regenerates every raster under `<root>/docs/brand/`. */
export async function exportBrand(options: { root: string }): Promise<void> {
  await exportMarks(options);
  await exportCovers(options);
}

if (import.meta.main) {
  await exportBrand({ root: join(import.meta.dir, "..", "..") });
}
