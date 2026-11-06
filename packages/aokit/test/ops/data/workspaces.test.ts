import { expect, test } from "bun:test";
import { Vfs } from "../../../src/engine/index.ts";
import { wireWorkspaces } from "../../../src/ops/data/index.ts";
import { parseJsonAt } from "../../helpers/cli-json.ts";

function opVfs(vfs: Vfs) {
  return {
    has: (path: string) => vfs.has(path),
    paths: () => vfs.paths(),
    read: (path: string) => vfs.read(path),
    write: (path: string, content: string | Uint8Array) => vfs.write(path, content),
  };
}

test("wireWorkspaces unions an existing workspaces list and stays idempotent", () => {
  const vfs = Vfs.empty();
  vfs.write("package.json", '{ "workspaces": ["apps/web"] }\n');
  vfs.write("apps/server/package.json", "{}\n");
  vfs.write("apps/web/package.json", '{ "name": "mine" }\n');
  wireWorkspaces(opVfs(vfs), "monorepo");
  const once = String(vfs.read("package.json"));
  expect(parseJsonAt(once, "workspaces")).toEqual(["apps/server", "apps/web"]);
  expect(parseJsonAt(String(vfs.read("apps/web/package.json")), "name")).toBe("mine");
  wireWorkspaces(opVfs(vfs), "monorepo");
  expect(String(vfs.read("package.json"))).toBe(once);
});

test("wireWorkspaces leaves a single Project untouched", () => {
  const vfs = Vfs.empty();
  vfs.write("package.json", "{}\n");
  wireWorkspaces(opVfs(vfs), "single");
  expect(String(vfs.read("package.json"))).toBe("{}\n");
});
