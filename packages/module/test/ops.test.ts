import { expect, test } from "bun:test";
import { opSchema } from "../src/ops.ts";

const byPath = { target: "config", file: "a.json" };
const byPoint = { extensionPoint: "lint.ignores", range: "^1" };

function accepts(op: Record<string, unknown>): boolean {
  return opSchema.safeParse(op).success;
}

test("a data Op accepts a path or an Extension point", () => {
  expect(accepts({ op: "mergeJson", ...byPath, value: {} })).toBe(true);
  expect(accepts({ op: "mergeJson", ...byPoint, value: ["a"] })).toBe(true);
  expect(accepts({ op: "mergeYaml", ...byPoint, value: {} })).toBe(true);
  expect(accepts({ op: "addEnv", ...byPoint, entries: {} })).toBe(true);
  expect(accepts({ op: "appendRegion", ...byPoint, region: "r", content: "" })).toBe(true);
  expect(accepts({ op: "addCssAtRule", ...byPoint, rule: "import", params: "x" })).toBe(true);
});

test("a data Op rejects both addresses together or neither", () => {
  expect(accepts({ op: "mergeJson", ...byPath, ...byPoint, value: {} })).toBe(false);
  expect(accepts({ op: "mergeJson", value: {} })).toBe(false);
  expect(accepts({ op: "addEnv", target: "root", ...byPoint, entries: {} })).toBe(false);
  expect(accepts({ op: "addEnv", entries: {} })).toBe(false);
});
