import { expect, test } from "bun:test";
import { mergeJsonc } from "../../src/patchers/jsonc/index.ts";

const source = `{
  // keep me
  "b": 1, /* inline */
  "list": ["x"]
}
`;

test("mergeJsonc keeps comments and inserts new keys in sorted position", () => {
  const result = mergeJsonc(source, { a: true, list: ["y", "x"] });
  expect(result).toContain("// keep me");
  expect(result).toContain("/* inline */");
  expect(Bun.JSONC.parse(result)).toEqual({ a: true, b: 1, list: ["x", "y"] });
  expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
});

test("mergeJsonc merges nested objects and is idempotent", () => {
  const patch = { compilerOptions: { strict: true, alpha: 1 } };
  const once = mergeJsonc(source, patch);
  expect(mergeJsonc(once, patch)).toBe(once);
  expect(Bun.JSONC.parse(once)).toMatchObject({ compilerOptions: { alpha: 1, strict: true } });
});

test("mergeJsonc creates the document from empty text", () => {
  expect(Bun.JSONC.parse(mergeJsonc("", { z: 1, a: 2 }))).toEqual({ a: 2, z: 1 });
});

test("mergeJsonc keeps comments inside arrays when appending", () => {
  const result = mergeJsonc('{"a": ["x", // keep me\n "y"]}\n', { a: ["z"] });
  expect(result).toContain("// keep me");
  expect(result).toContain('"z"');
});
