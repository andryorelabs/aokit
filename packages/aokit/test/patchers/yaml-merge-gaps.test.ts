import { expect, test } from "bun:test";
import { mergeYaml } from "../../src/patchers/yaml/index.ts";

test("mergeYaml appends new items to a sequence reached through an alias", () => {
  const result = mergeYaml("base: &b [1, 2]\ndev: *b\n", { dev: [2, 3] });
  expect(result).toContain("base: &b");
  expect(result).toContain("3");
  expect(mergeYaml(result, { dev: [2, 3] })).toBe(result);
});

test("mergeYaml replaces a plain scalar with the patch value", () => {
  expect(mergeYaml("a: 1\nb: keep\n", { a: 2 })).toBe("a: 2\nb: keep\n");
});

test("mergeYaml leaves an equal scalar alone", () => {
  const text = "a: 1 # note\n";
  expect(mergeYaml(text, { a: 1 })).toBe(text);
});
