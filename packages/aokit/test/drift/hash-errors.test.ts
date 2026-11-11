import { expect, test } from "bun:test";
import { hashTrackedFile } from "../../src/drift/hash.ts";

test("a failure that is not a malformed Region is not read as modified bytes", () => {
  const notBytes = new Proxy(new Uint8Array(1), {});
  expect(() => hashTrackedFile("AGENTS.md", notBytes)).toThrow(TypeError);
});
