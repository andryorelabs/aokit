import { expect, test } from "bun:test";
import { buildSelection, expectBuilt } from "./deploy/support.ts";

function packageJson(text: string | Uint8Array | undefined): Record<string, unknown> {
  const parsed: Record<string, unknown> = JSON.parse(String(text));
  return parsed;
}

test("hono alone on single writes the server base and its dependencies", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono"]));
  expect(plan.vfs.paths()).toEqual(["package.json", "src/server/app.ts"]);

  const manifest = packageJson(plan.vfs.read("package.json"));
  expect(manifest["dependencies"]).toEqual({ hono: "^4.13.16" });
  expect(manifest["devDependencies"]).toEqual({ "@types/bun": "^1.4.4" });
});

test("hono alone on monorepo writes the server package", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono"], { layout: "monorepo" }));
  expect(plan.vfs.paths()).toEqual([
    "apps/server/app.ts",
    "apps/server/package.json",
    "package.json",
  ]);

  const manifest = packageJson(plan.vfs.read("apps/server/package.json"));
  expect(manifest["dependencies"]).toEqual({ hono: "catalog:" });
  expect(manifest["devDependencies"]).toEqual({ "@types/bun": "catalog:" });
});

test("hono keeps middleware and routes as top-level declarations", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono"]));
  const source = String(plan.vfs.read("src/server/app.ts"));
  expect(source).toMatch(/^export const middleware\b/m);
  expect(source).toMatch(/^export const routes\b/m);
  expect(source).not.toContain("{{");
});

test("hono records server and api:http in the Lockfile", async () => {
  const { lockfile } = expectBuilt(await buildSelection(["hono"]));
  expect(Object.keys(lockfile.modules)).toEqual(["hono"]);
  expect(Object.keys(lockfile.files)).toEqual(["package.json", "src/server/app.ts"]);
});
