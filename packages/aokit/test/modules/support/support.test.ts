import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { catalogSchema } from "@aokit/module";

import { buildSelection, draftCatalog } from "./index.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "..", "..", "..", "registry-src");

test("the draft Catalog keeps every dependency of the latest Release Catalog", () => {
  const raw: unknown = JSON.parse(
    readFileSync(join(sourceRoot, "catalog", "2026.12.2.json"), "utf8"),
  );
  if (typeof raw !== "object" || raw === null) throw new Error("the Catalog is not an object");
  const latest = catalogSchema.parse(
    Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "modules")),
  );
  expect(draftCatalog().dependencies).toMatchObject(latest.dependencies);
  expect(draftCatalog().pinGroups).toMatchObject(latest.pinGroups);
});

test("buildSelection builds a curated Module with draft Catalog dependencies", async () => {
  const built = await buildSelection(["oxc"], "single");
  if (!built.ok) throw new Error(built.error.message);
  expect(built.lockfile.deps.oxlint).toMatchObject({ pinned: true });
});
