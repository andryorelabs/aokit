import { describe, expect, spyOn, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

import {
  assertFontsLoaded,
  exportBrand,
  exportCovers,
  findCachedChromium,
  launchChromium,
  renderCover,
  specFor,
  type BrowserLike,
  type ContextLike,
  type PageLike,
  type RouteLike,
} from "./brand-export.ts";
import { COVER_SPECS, readPngSize } from "./brand-export-spec.ts";

interface FakeOptions {
  readonly fonts?: unknown;
  readonly blockedUrl?: string;
  readonly wrongSize?: boolean;
}

interface FakeBrowser {
  readonly browser: BrowserLike;
  readonly closed: () => boolean;
  readonly matcher: () => ((url: URL) => boolean) | undefined;
  readonly aborted: () => number;
}

const GOOD_FONTS = ["Geist", "Geist Mono"];
const WRONG_WIDTH = 10;
const noop = (): Promise<void> => Promise.resolve();

async function solidPng(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(buffer);
}

function fakePage(options: FakeOptions, fire: (url: string) => Promise<void>): PageLike {
  let viewport = { width: 1, height: 1 };
  return {
    setViewportSize: (size) => {
      viewport = size;
      return noop();
    },
    goto: async (url) => {
      if (options.blockedUrl !== undefined) await fire(options.blockedUrl);
      return url;
    },
    evaluate: () => Promise.resolve(options.fonts ?? GOOD_FONTS),
    screenshot: () =>
      solidPng(options.wrongSize === true ? WRONG_WIDTH : viewport.width, viewport.height),
  };
}

function fakeBrowser(options: FakeOptions = {}): FakeBrowser {
  let closed = false;
  let aborted = 0;
  let matcher: ((url: URL) => boolean) | undefined;
  let handler: ((route: RouteLike) => Promise<void>) | undefined;
  const fire = async (url: string): Promise<void> => {
    await handler?.({
      request: () => ({ url: () => url }),
      abort: () => {
        aborted += 1;
        return noop();
      },
    });
  };
  const context: ContextLike = {
    route: (given, run) => {
      matcher = given;
      handler = run;
      return noop();
    },
    newPage: () => Promise.resolve(fakePage(options, fire)),
  };
  const browser: BrowserLike = {
    newContext: () => Promise.resolve(context),
    close: () => {
      closed = true;
      return noop();
    },
  };
  return { browser, closed: () => closed, matcher: () => matcher, aborted: () => aborted };
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  return run().then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

async function withRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "brand-export-runtime-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("exportCovers", () => {
  test("writes every cover at its spec size and closes the browser", async () => {
    const fake = fakeBrowser();
    await withRoot(async (root) => {
      await exportCovers({ root }, () => Promise.resolve(fake.browser));
      const sizes = await Promise.all(
        COVER_SPECS.map(async (cover) =>
          readPngSize(
            new Uint8Array(await readFile(join(root, "docs/brand/og", `${cover.name}.png`))),
          ),
        ),
      );
      expect(sizes).toEqual(COVER_SPECS.map(({ width, height }) => ({ width, height })));
    });
    expect(fake.closed()).toBe(true);
    expect(fake.matcher()?.(new URL("https://example.com/x"))).toBe(true);
    expect(fake.matcher()?.(new URL("file:///tmp/x.html"))).toBe(false);
  });

  test("rejects a cover that makes non-file requests and still closes", async () => {
    const fake = fakeBrowser({ blockedUrl: "https://fonts.example/geist.css" });
    const message = await withRoot((root) =>
      rejection(() => exportCovers({ root }, () => Promise.resolve(fake.browser))),
    );
    expect(message).toContain("made non-file requests: https://fonts.example/geist.css");
    expect(fake.aborted()).toBeGreaterThan(0);
    expect(fake.closed()).toBe(true);
  });

  test("rejects a screenshot that breaks the spec before writing", async () => {
    const fake = fakeBrowser({ wrongSize: true });
    const message = await withRoot((root) =>
      rejection(() => exportCovers({ root }, () => Promise.resolve(fake.browser))),
    );
    expect(message).toContain("expected");
    expect(fake.closed()).toBe(true);
  });
});

describe("renderCover", () => {
  test("sets the viewport and returns the screenshot bytes", async () => {
    const page = fakePage({}, noop);
    const cover = COVER_SPECS[2];
    const bytes = await renderCover(page, "/brand", cover, []);
    expect(readPngSize(bytes)).toEqual({ width: cover.width, height: cover.height });
  });
});

describe("assertFontsLoaded", () => {
  test("passes when both families are loaded", async () => {
    const message = await rejection(() => assertFontsLoaded(fakePage({}, noop), "cover"));
    expect(message).toBe("resolved");
  });

  test("names the missing family", async () => {
    const page = fakePage({ fonts: ["Geist"] }, noop);
    const message = await rejection(() => assertFontsLoaded(page, "cover"));
    expect(message).toBe("cover.html: font Geist Mono did not load");
  });

  test("treats a non-array result as nothing loaded", async () => {
    const page = fakePage({ fonts: "nope" }, noop);
    const message = await rejection(() => assertFontsLoaded(page, "cover"));
    expect(message).toBe("cover.html: font Geist did not load");
  });
});

async function installChrome(cache: string, build: string): Promise<string> {
  const directory = join(cache, build, "chrome-linux64");
  await mkdir(directory, { recursive: true });
  const executable = join(directory, "chrome");
  await writeFile(executable, "");
  return executable;
}

describe("findCachedChromium", () => {
  test("returns the newest build that has an executable", async () => {
    await withRoot(async (cache) => {
      await installChrome(cache, "chromium-1100");
      const newest = await installChrome(cache, "chromium-1200");
      await mkdir(join(cache, "chromium-1300"), { recursive: true });
      await mkdir(join(cache, "firefox-9999"), { recursive: true });
      expect(await findCachedChromium(cache)).toBe(newest);
    });
  });

  test("returns undefined when nothing is cached or the cache is missing", async () => {
    await withRoot(async (cache) => {
      expect(await findCachedChromium(cache)).toBeUndefined();
      expect(await findCachedChromium(join(cache, "missing"))).toBeUndefined();
    });
  });
});

describe("specFor", () => {
  test("throws for a path with no raster spec", () => {
    expect(() => specFor("og/missing.png")).toThrow("No raster spec for og/missing.png");
  });
});

describe("exportBrand", () => {
  test("writes the marks and the covers through the supplied browser", async () => {
    const fake = fakeBrowser();
    const mark = new URL("../../docs/brand/logo/mark.svg", import.meta.url);
    await withRoot(async (root) => {
      await cp(mark, join(root, "docs/brand/logo/mark.svg"), { recursive: true });
      await exportBrand({ root }, () => Promise.resolve(fake.browser));
      const favicon = await readFile(join(root, "docs/brand/logo/png/favicon.ico"));
      const cover = await readFile(join(root, "docs/brand/og/cover.png"));
      expect(favicon.length).toBeGreaterThan(0);
      expect(cover.length).toBeGreaterThan(0);
    });
    expect(fake.closed()).toBe(true);
  });
});

async function launchOptionsFor(cache: string): Promise<unknown[]> {
  const previous = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  process.env["PLAYWRIGHT_BROWSERS_PATH"] = cache;
  const launch = spyOn(chromium, "launch").mockRejectedValue(new Error("launch stopped"));
  try {
    expect(await rejection(() => launchChromium())).toBe("launch stopped");
    return launch.mock.calls.map(([options]) => options);
  } finally {
    launch.mockRestore();
    if (previous === undefined) delete process.env["PLAYWRIGHT_BROWSERS_PATH"];
    else process.env["PLAYWRIGHT_BROWSERS_PATH"] = previous;
  }
}

describe("launchChromium", () => {
  test("passes the cached executable to Playwright", async () => {
    await withRoot(async (cache) => {
      const executable = await installChrome(cache, "chromium-1200");
      expect(await launchOptionsFor(cache)).toEqual([{ executablePath: executable }]);
    });
  });

  test("falls back to Playwright's default when nothing is cached", async () => {
    await withRoot(async (cache) => {
      expect(await launchOptionsFor(cache)).toEqual([{}]);
    });
  });
});
