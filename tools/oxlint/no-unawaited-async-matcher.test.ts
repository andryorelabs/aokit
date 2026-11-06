import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLocalRuleLinter } from "./lint-fixture.ts";
import type { LocalRuleLinter } from "./lint-fixture.ts";

let linter: LocalRuleLinter;

beforeAll(async () => {
  linter = await createLocalRuleLinter("no-unawaited-async-matcher");
});

afterAll(async () => {
  await linter.dispose();
});

describe("local/no-unawaited-async-matcher", () => {
  test.each([
    "expect(promise).rejects.toThrow();",
    "expect(promise).resolves.toBe(1);",
    "expect(promise).rejects.not.toThrow();",
    "const pending = expect(promise).resolves.toBe(1);",
  ])("rejects the unawaited statement %s", async (statement) => {
    const messages = await linter.lint(`test("x", async () => {\n  ${statement}\n});\n`);
    expect(messages).toHaveLength(1);
  });

  test.each([
    "await expect(promise).rejects.toThrow();",
    "await expect(promise).resolves.toBe(1);",
    "return expect(promise).resolves.toBe(1);",
  ])("allows the awaited or returned form %s", async (statement) => {
    expect(await linter.lint(`test("x", async () => {\n  ${statement}\n});\n`)).toEqual([]);
  });

  test("allows an arrow function that returns the assertion", async () => {
    expect(await linter.lint('test("x", () => expect(promise).rejects.toThrow());\n')).toEqual([]);
  });

  test("ignores synchronous matchers", async () => {
    expect(await linter.lint('test("x", () => {\n  expect(value).toBe(1);\n});\n')).toEqual([]);
  });
});
