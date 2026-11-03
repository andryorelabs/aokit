import { expect, test } from "bun:test";
import { supportedManifestSchemaVersion } from "@aokit/module";

test("@aokit/module resolves through its package entry", () => {
  expect(supportedManifestSchemaVersion).toBe(1);
});
