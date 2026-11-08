import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { catalogSchema } from "@aokit/module";
import { buildSelection, draftCatalog } from "./index.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "..", "registry-src");

test("the draft Catalog keeps every dependency of the latest Release Catalog", () => {
  const latest = catalogSchema.parse(
    JSON.parse(readFileSync(join(sourceRoot, "catalog", "2026.11.2.json"), "utf8")),
  );
  expect(draftCatalog().dependencies).toMatchObject(latest.dependencies);
  expect(draftCatalog().pinGroups).toMatchObject(latest.pinGroups);
});

test("buildSelection builds a curated Module with draft Catalog dependencies", async () => {
  const built = await buildSelection(["oxc"], "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(built.lockfile.deps["oxlint"]).toMatchObject({ pinned: true });
});
