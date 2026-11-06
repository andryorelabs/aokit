import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLocalRuleLinter } from "./lint-fixture.ts";
import type { LocalRuleLinter } from "./lint-fixture.ts";

let linter: LocalRuleLinter;

beforeAll(async () => {
  linter = await createLocalRuleLinter("require-description");
});

afterAll(async () => {
  await linter.dispose();
});

describe("local/require-description", () => {
  test.each([
    "// oxlint-disable-next-line no-console",
    "// eslint-disable-next-line no-console",
    "/* eslint-disable no-console */",
    "// oxlint-disable-line no-console",
    "// oxlint-disable-next-line no-console --",
    "// oxlint-disable-next-line no-console -- ",
  ])("rejects %s without a reason", async (directive) => {
    expect(await linter.lint(`${directive}\nexport const answer = 42;\n`)).toHaveLength(1);
  });

  test.each([
    "// oxlint-disable-next-line no-console -- the CLI prints to stdout",
    "/* eslint-disable no-console -- the CLI prints to stdout */",
    "// eslint-disable-line no-console -- reason",
  ])("allows %s with a reason", async (directive) => {
    expect(await linter.lint(`${directive}\nexport const answer = 42;\n`)).toEqual([]);
  });

  test("ignores comments that only mention a directive", async () => {
    expect(await linter.lint("// see oxlint-disable docs\nexport const answer = 42;\n")).toEqual(
      [],
    );
  });
});
