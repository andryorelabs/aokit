import { expect, test } from "bun:test";
import { appendRegion } from "../../src/patchers/markdown/index.ts";

const source = `# Title

free text

<!-- aokit:begin other -->
theirs
<!-- aokit:end other -->
`;

test("appendRegion appends a new region and leaves everything else untouched", () => {
  const result = appendRegion(source, { module: "mine", content: "hello" });
  expect(result.startsWith(source)).toBe(true);
  expect(result).toContain("<!-- aokit:begin mine -->\nhello\n<!-- aokit:end mine -->");
});

test("appendRegion rewrites only its own region", () => {
  const once = appendRegion(source, { module: "mine", content: "v1" });
  const twice = appendRegion(once, { module: "mine", content: "v2" });
  expect(twice).toContain("v2");
  expect(twice).not.toContain("v1");
  expect(twice).toContain("theirs");
  expect(twice).toContain("free text");
});

test("appendRegion is idempotent", () => {
  const once = appendRegion(source, { module: "mine", content: "v1" });
  expect(appendRegion(once, { module: "mine", content: "v1" })).toBe(once);
});

test("appendRegion fails on an unterminated own region", () => {
  expect(() =>
    appendRegion("<!-- aokit:begin mine -->\nx\n", { module: "mine", content: "y" }),
  ).toThrow(/mine/);
});
