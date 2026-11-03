import { expect, test } from "bun:test";
import { mergePackageJson } from "../../src/patchers/package-json/index.ts";

const source = JSON.stringify({
  name: "app",
  dependencies: { zod: "^3.0.0", b: "^1.0.0" },
});

test("mergePackageJson merges dependencies by name with sorted keys and keeps existing ranges", () => {
  const result = mergePackageJson(source, {
    dependencies: { a: "^2.0.0", zod: "^4.0.0" },
    devDependencies: { typescript: "6.0.0" },
    scripts: { test: "bun test", build: "x" },
  });
  const parsed: Record<string, unknown> = JSON.parse(result);
  expect(Object.keys(Object(parsed.dependencies))).toEqual(["a", "b", "zod"]);
  expect(Object(parsed.dependencies)).toHaveProperty("zod", "^3.0.0");
  expect(Object.keys(Object(parsed.scripts))).toEqual(["build", "test"]);
  expect(Object.keys(parsed)[0]).toBe("name");
});

test("mergePackageJson is idempotent", () => {
  const patch = { dependencies: { a: "^2.0.0" } };
  const once = mergePackageJson(source, patch);
  expect(mergePackageJson(once, patch)).toBe(once);
});
