import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BRANDBOOK_DIR = fileURLToPath(new URL("../../docs/brand/brandbook/", import.meta.url));

const LOGO_FILES = [
  "mark.svg",
  "mark-white.svg",
  "lockup-horizontal.svg",
  "lockup-horizontal-dark.svg",
] as const;

function read(file: string): string {
  return readFileSync(resolve(BRANDBOOK_DIR, file), "utf8");
}

function captureAll(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

const html = read("index.html");
const fontsCss = read("fonts.css");
const pageReferences = captureAll(html, /(?:src|href)="([^"]+)"/g);
const fontReferences = captureAll(fontsCss, /url\("([^"]+)"\)/g);

describe("brandbook page", () => {
  test("makes no http(s) or protocol-relative references", () => {
    for (const source of [html, fontsCss]) {
      expect(source).not.toMatch(/https?:\/\//i);
      expect(source).not.toMatch(/(?:src|href)="\/\//);
    }
  });

  test("links only existing relative files", () => {
    expect(pageReferences.length).toBeGreaterThan(0);
    for (const reference of pageReferences) {
      expect(reference.startsWith("/")).toBe(false);
      expect(existsSync(resolve(BRANDBOOK_DIR, reference))).toBe(true);
    }
    for (const reference of fontReferences) {
      expect(existsSync(resolve(BRANDBOOK_DIR, reference))).toBe(true);
    }
  });

  test("declares both committed fonts", () => {
    expect(fontsCss).toContain('font-family: "Geist"');
    expect(fontsCss).toContain('font-family: "Geist Mono"');
    expect(fontReferences).toHaveLength(2);
  });

  test("shows both grades, every logo and the brand line", () => {
    expect(html).toContain("grade-dark");
    expect(html).toContain('class="panel light"');
    for (const logo of LOGO_FILES) {
      expect(html).toContain(`../logo/${logo}`);
    }
    expect(html).toContain("Projects from Modules. Updates that merge.");
  });
});
