import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogSchema, composeDraftCatalog } from "@aokit/module";

const releaseCatalog = {
  release: "2026.11.2",
  dependencies: { hono: "^4.0.0", oxlint: "1.90.0", oxfmt: "0.75.0" },
  pinGroups: { oxc: ["oxlint", "oxfmt"] },
};

const temporaryRoots: string[] = [];

function writeSource(fragments: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "aokit-draft-catalog-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "catalog"));
  writeFileSync(
    join(root, "catalog", "2026.11.1.json"),
    JSON.stringify({ release: "2026.11.1", dependencies: {} }),
  );
  writeFileSync(
    join(root, "catalog", "2026.11.2.json"),
    JSON.stringify({ ...releaseCatalog, modules: {} }),
  );
  for (const [module, fragment] of Object.entries(fragments)) {
    mkdirSync(join(root, module));
    writeFileSync(join(root, module, "catalog.json"), JSON.stringify(fragment));
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the draft Catalog equals the latest Release Catalog without fragments", () => {
  expect(composeDraftCatalog(writeSource({}))).toEqual(catalogSchema.parse(releaseCatalog));
});

test("the draft Catalog adds every fragment dependency and pin group", () => {
  const draft = composeDraftCatalog(
    writeSource({
      alpha: { dependencies: { zod: "^4.0.0", effect: "^3.0.0" }, pinGroups: { fx: ["effect"] } },
      beta: { dependencies: { zod: "^4.0.0" } },
    }),
  );
  expect(draft.dependencies).toEqual({
    effect: "^3.0.0",
    hono: "^4.0.0",
    oxfmt: "0.75.0",
    oxlint: "1.90.0",
    zod: "^4.0.0",
  });
  expect(draft.pinGroups).toEqual({ oxc: ["oxlint", "oxfmt"], fx: ["effect"] });
  expect(draft.release).toBe("2026.11.2");
});

test("two fragments that disagree on a dependency range are an error", () => {
  const source = writeSource({
    alpha: { dependencies: { zod: "^3.0.0" } },
    beta: { dependencies: { zod: "^4.0.0" } },
  });
  expect(() => composeDraftCatalog(source)).toThrow(/alpha and beta disagree on "zod"/);
});

test("a fragment that redefines a released dependency is an error", () => {
  const source = writeSource({ alpha: { dependencies: { hono: "^5.0.0" } } });
  expect(() => composeDraftCatalog(source)).toThrow(/alpha\/catalog.json redefines "hono"/);
});

test("a fragment that redefines a released pin group is an error", () => {
  const source = writeSource({
    alpha: { dependencies: { zod: "^4.0.0" }, pinGroups: { oxc: ["zod"] } },
  });
  expect(() => composeDraftCatalog(source)).toThrow(/redefines pin group "oxc"/);
});

test("a source without any Release Catalog is an error", () => {
  const root = mkdtempSync(join(tmpdir(), "aokit-draft-catalog-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "catalog"));
  expect(() => composeDraftCatalog(root)).toThrow(/no Release Catalog/);
});

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
