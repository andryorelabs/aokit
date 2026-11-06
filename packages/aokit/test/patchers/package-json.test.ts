import { expect, test } from "bun:test";
import { mergePackageJson } from "../../src/patchers/package-json/index.ts";
import { jsonAt, keysAt, parseJson } from "../helpers/cli-json.ts";

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
  const parsed = parseJson(result);
  expect(keysAt(parsed, "dependencies")).toEqual(["a", "b", "zod"]);
  expect(jsonAt(parsed, "dependencies", "zod")).toBe("^3.0.0");
  expect(keysAt(parsed, "scripts")).toEqual(["build", "test"]);
  expect(keysAt(parsed)[0]).toBe("name");
});

test("mergePackageJson is idempotent", () => {
  const patch = { dependencies: { a: "^2.0.0" } };
  const once = mergePackageJson(source, patch);
  expect(mergePackageJson(once, patch)).toBe(once);
});
