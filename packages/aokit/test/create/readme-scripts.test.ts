import { expect, test } from "bun:test";
import { Vfs } from "../../src/engine/index.ts";
import { hashVfs, type Plan } from "../../src/engine/plan.ts";
import { withProjectReadme } from "../../src/create/readme.ts";

function readmeFor(packageJson: string): string {
  const vfs = Vfs.empty();
  vfs.write("package.json", packageJson);
  const plan: Plan = { changes: [], hash: hashVfs(vfs), vfs };
  const readme = withProjectReadme(plan, "/tmp/app", []).vfs.read("README.md");
  if (typeof readme !== "string") throw new Error("the README was not written");
  return readme;
}

test.each([
  ["invalid JSON", "{ not json"],
  ["a null document", "null"],
  ["a document without scripts", JSON.stringify({ name: "app" })],
  ["null scripts", JSON.stringify({ scripts: null })],
])("a package.json with %s yields a README without scripts", (_label, packageJson) => {
  const readme = readmeFor(packageJson);
  expect(readme).toContain("## Modules");
  expect(readme).not.toContain("bun run");
});

test("a package.json with scripts lists them", () => {
  const readme = readmeFor(JSON.stringify({ scripts: { build: "tsc" } }));
  expect(readme).toContain("`bun run build`");
});
