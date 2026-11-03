import { expect, test } from "bun:test";
import { catalogSchema } from "@aokit/module";

test("a Catalog may name the release it belongs to", () => {
  const catalog = catalogSchema.parse({
    release: "2026.11.0",
    dependencies: { oxlint: "1.90.0" },
    pinGroups: { oxc: ["oxlint"] },
  });
  expect(catalog.release).toBe("2026.11.0");
});

test("a Catalog without a release stays valid", () => {
  const catalog = catalogSchema.parse({ dependencies: { zod: "^4.0.0" } });
  expect(catalog.release).toBeUndefined();
  expect(catalog.pinGroups).toEqual({});
});

test("an empty release is rejected", () => {
  expect(catalogSchema.safeParse({ release: "", dependencies: {} }).success).toBe(false);
});
