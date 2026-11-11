import { expect, test } from "bun:test";
import { renderHuman } from "../../src/cli/human.ts";

test.each([null, 42, true])("a non-object value %p prints as sorted JSON", (value) => {
  expect(renderHuman(value)).toBe(JSON.stringify(value));
});
