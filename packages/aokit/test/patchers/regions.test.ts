import { describe, expect, test } from "bun:test";
import { appendRegion } from "../../src/patchers/markdown/index.ts";
import {
  isRegionFile,
  parseRegions,
  regionDigest,
  RegionSyntaxError,
  removeRegion,
  spliceRegions,
  upsertRegion,
} from "../../src/patchers/markdown/regions.ts";

const block = (id: string, body: string): string =>
  `<!-- aokit:begin ${id} -->\n${body}\n<!-- aokit:end ${id} -->`;

describe("parseRegions", () => {
  test("returns each region with its id and body", () => {
    const spans = parseRegions(`intro\n\n${block("a", "one")}\n\n${block("b", "two\nlines")}\n`);
    expect(spans.map((span) => [span.id, span.body])).toEqual([
      ["a", "one"],
      ["b", "two\nlines"],
    ]);
  });

  test("rejects a start marker without an end", () => {
    expect(() => parseRegions("<!-- aokit:begin a -->\nx\n")).toThrow(RegionSyntaxError);
  });

  test("rejects a repeated id", () => {
    expect(() => parseRegions(`${block("a", "1")}\n${block("a", "2")}`)).toThrow(/more than once/);
  });

  test("upsert and splice throw when the target is malformed", () => {
    const broken = "<!-- aokit:begin a -->\nx\n";
    expect(() => upsertRegion(broken, { id: "b", content: "y" }, "top")).toThrow(RegionSyntaxError);
    expect(() => spliceRegions(broken, block("b", "y"))).toThrow(RegionSyntaxError);
  });
});

describe("upsertRegion", () => {
  test("replaces a region in place", () => {
    const text = `top\n\n${block("a", "old")}\n\nbottom\n`;
    expect(upsertRegion(text, { id: "a", content: "new" }, "top")).toBe(
      `top\n\n${block("a", "new")}\n\nbottom\n`,
    );
  });

  test("inserts after the last region", () => {
    const text = `${block("a", "1")}\n\nuser text\n`;
    expect(upsertRegion(text, { id: "b", content: "2" }, "afterLastRegion")).toBe(
      `${block("a", "1")}\n\n${block("b", "2")}\n\nuser text\n`,
    );
  });

  test("appends at the end when there is no region", () => {
    expect(upsertRegion("hello\n", { id: "a", content: "1" }, "afterLastRegion")).toBe(
      `hello\n\n${block("a", "1")}\n`,
    );
  });

  test("inserts at the top", () => {
    expect(upsertRegion("hello\n", { id: "header", content: "h" }, "top")).toBe(
      `${block("header", "h")}\n\nhello\n`,
    );
  });
});

describe("removeRegion", () => {
  test("removes a region and its separator", () => {
    const text = `${block("a", "1")}\n\n${block("b", "2")}\n\nuser\n`;
    expect(removeRegion(text, "b")).toBe(`${block("a", "1")}\n\nuser\n`);
    expect(removeRegion(`user\n\n${block("a", "1")}\n`, "a")).toBe("user\n");
  });

  test("leaves text unchanged for an absent id", () => {
    expect(removeRegion("plain\n", "a")).toBe("plain\n");
  });
});

describe("spliceRegions", () => {
  test("updates regions in place and keeps user text", () => {
    const user = `mine\n\n${block("a", "old")}\n\nmore mine\n`;
    expect(spliceRegions(user, `${block("a", "new")}\n`)).toBe(
      `mine\n\n${block("a", "new")}\n\nmore mine\n`,
    );
  });

  test("adds new regions: leading one on top, others after the last", () => {
    const rendered = `${block("header", "h")}\n\n${block("b", "2")}\n`;
    const result = spliceRegions(`${block("a", "1")}\n\nmine\n`, rendered);
    expect(result).toBe(
      `${block("header", "h")}\n\n${block("a", "1")}\n\n${block("b", "2")}\n\nmine\n`,
    );
  });
});

describe("appendRegion", () => {
  test("inserts after the last aokit region instead of the end of the file", () => {
    const text = `${block("other", "x")}\n\nuser notes\n`;
    const result = appendRegion(text, { module: "mine", content: "y" });
    expect(result.indexOf("aokit:begin mine")).toBeLessThan(result.indexOf("user notes"));
  });
});

describe("isRegionFile / regionDigest", () => {
  test("only the root AGENTS.md and CLAUDE.md are Region files", () => {
    expect(isRegionFile("AGENTS.md")).toBe(true);
    expect(isRegionFile("CLAUDE.md")).toBe(true);
    expect(isRegionFile("docs/AGENTS.md")).toBe(false);
    expect(isRegionFile("README.md")).toBe(false);
  });

  test("the digest ignores text outside markers and line endings", () => {
    const lf = `intro\n${block("a", "1\n2")}\ntail\n`;
    const crlf = `different\n${block("a", "1\n2")}\nother\n`.replaceAll("\n", "\r\n");
    expect(regionDigest(crlf)).toBe(regionDigest(lf));
    expect(regionDigest(block("a", "1\n3"))).not.toBe(regionDigest(lf));
  });
});
