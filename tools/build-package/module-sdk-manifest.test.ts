import { expect, test } from "bun:test";
import { publishManifestOf } from "./module-sdk.ts";

test("a publishConfig.exports target outside dist/ is rejected", () => {
  expect(() =>
    publishManifestOf({ publishConfig: { exports: { ".": "./src/index.js" } } }),
  ).toThrow("is not under ./dist/");
});

test("a publishConfig.exports value that is not a string or an object is rejected", () => {
  expect(() => publishManifestOf({ publishConfig: { exports: { ".": 3 } } })).toThrow(
    "holds an unsupported value: 3",
  );
});

test("exports is added from publishConfig.exports when the source has none", () => {
  expect(
    publishManifestOf({ name: "x", publishConfig: { exports: { ".": "./dist/index.js" } } }),
  ).toEqual({ name: "x", publishConfig: {}, exports: { ".": "./index.js" } });
});
