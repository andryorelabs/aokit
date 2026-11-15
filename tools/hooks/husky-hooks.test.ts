import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function hook(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../.husky/${name}`, import.meta.url)), "utf8");
}

describe("husky hooks", () => {
  test("pre-commit runs lint-staged without installing anything", () => {
    expect(hook("pre-commit").trim()).toBe("bun x --no-install lint-staged");
  });

  test("commit-msg runs commitlint on the message file", () => {
    expect(hook("commit-msg").trim()).toBe('bun x --no-install commitlint --edit "$1"');
  });
});
