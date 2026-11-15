import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createLocalRuleLinter } from "./lint-fixture.ts";
import type { LocalRuleLinter } from "./lint-fixture.ts";

let linter: LocalRuleLinter;

beforeAll(async () => {
  linter = await createLocalRuleLinter("no-bun-test-only");
});

afterAll(async () => {
  await linter.dispose();
});

describe("local/no-bun-test-only", () => {
  test.each([
    ['import { test } from "bun:test";', 'test.only("x", () => {});'],
    ['import { it } from "bun:test";', 'it.only("x", () => {});'],
    ['import { describe } from "bun:test";', 'describe.only("x", () => {});'],
    ['import { test as run } from "bun:test";', 'run.only("x", () => {});'],
    ['import { test } from "bun:test";', 'test.only.each([1])("x %d", () => {});'],
    ['import * as bun from "bun:test";', 'bun.test.only("x", () => {});'],
    ['import { test } from "bun:test";', 'test["only"]("x", () => {});'],
  ])("rejects %s %s", async (importLine, statement) => {
    const messages = await linter.lint(`${importLine}\n${statement}\n`);
    expect(messages).toHaveLength(1);
  });

  test.each([
    ['import { test } from "bun:test";', 'test("x", () => {});'],
    ['import { test } from "bun:test";', 'test.skip("x", () => {});'],
    ['import { test } from "vitest";', 'test.only("x", () => {});'],
    ["const test = { only: () => {} };", "test.only();"],
    ['import { expect } from "bun:test";', "expect.only;"],
  ])("allows %s %s", async (importLine, statement) => {
    expect(await linter.lint(`${importLine}\n${statement}\n`)).toEqual([]);
  });
});
