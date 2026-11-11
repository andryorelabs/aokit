import { describe, expect, test } from "bun:test";
import {
  RegionSyntaxError,
  parseRegions,
  upsertRegion,
} from "../../src/patchers/markdown/regions.ts";

const path = "src/a.ts";

describe("comment-syntax Regions mask non-code text", () => {
  test("a marker inside a block comment is ignored", () => {
    const text = "/* // aokit:begin hidden:r\nstill comment */\nconst x = 1;\n";
    expect(parseRegions(text, path)).toEqual([]);
  });

  test("an unterminated block comment is kept as text, so a marker inside it still counts", () => {
    expect(() => parseRegions("/* never closed\n// aokit:begin open:r\n", path)).toThrow(
      RegionSyntaxError,
    );
  });

  test("a regex literal that never closes does not swallow the file", () => {
    expect(parseRegions("const pattern = /unclosed", path)).toEqual([]);
    expect(parseRegions("const pattern = /unclosed\n", path)).toEqual([]);
  });

  test("a marker inside a string literal is ignored while a real Region is found", () => {
    const real = "// aokit:begin m:r\nbody\n// aokit:end m:r\n";
    const text = `const s = "// aokit:begin fake:r";\n${real}`;
    expect(parseRegions(text, path).map((span) => span.id)).toEqual(["m:r"]);
  });

  test("an end marker that trails code on its line is not taken as the end", () => {
    const text = [
      "// aokit:begin m:r",
      "keep(); // aokit:end m:r",
      "more",
      "// aokit:end m:r",
      "",
    ].join("\n");
    const [span] = parseRegions(text, path);
    expect(span?.body).toBe("keep(); // aokit:end m:r\nmore");
  });

  test("upserting into a file with a block comment keeps the comment intact", () => {
    const original = "/* header */\nconst x = 1;\n";
    const result = upsertRegion(original, { id: "m:r", content: "body" }, "afterLastRegion", path);
    expect(result.startsWith(original)).toBe(true);
    expect(parseRegions(result, path).map((span) => span.id)).toEqual(["m:r"]);
  });
});
