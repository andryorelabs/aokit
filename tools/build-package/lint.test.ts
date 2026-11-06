import { expect, test } from "bun:test";
import { findMissingTarballEntries } from "./lint.ts";

test("findMissingTarballEntries reports files and directories absent from the tarball", () => {
  const packed = ["package.json", "LICENSE", "dist/cli.js"];
  expect(findMissingTarballEntries(packed, ["package.json", "dist/", "registry/"])).toEqual([
    "registry/",
  ]);
  expect(findMissingTarballEntries(packed, ["README.md"])).toEqual(["README.md"]);
});
