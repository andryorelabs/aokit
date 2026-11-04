import { expect, test } from "bun:test";
import { buildSelection, expectBuilt } from "./deploy/support.ts";

function packageJson(text: string | Uint8Array | undefined): Record<string, unknown> {
  const parsed: Record<string, unknown> = JSON.parse(String(text));
  return parsed;
}

test("hono alone on single writes the server base and its dependencies", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono"]));
  expect(plan.vfs.paths()).toEqual([
    ".claude/skills/hono-add-route/SKILL.md",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "src/app.ts",
  ]);

  const manifest = packageJson(plan.vfs.read("package.json"));
  expect(manifest["dependencies"]).toEqual({ hono: "^4.13.16" });
  expect(manifest["devDependencies"]).toEqual({ "@types/bun": "^1.4.4" });
});

test("hono alone on monorepo writes the server package", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono"], { layout: "monorepo" }));
  expect(plan.vfs.paths()).toEqual([
    ".claude/skills/hono-add-route/SKILL.md",
    "AGENTS.md",
    "CLAUDE.md",
    "apps/server/package.json",
    "apps/server/src/app.ts",
    "package.json",
  ]);

  const manifest = packageJson(plan.vfs.read("apps/server/package.json"));
  expect(manifest["dependencies"]).toEqual({ hono: "catalog:" });
  expect(manifest["devDependencies"]).toEqual({ "@types/bun": "catalog:" });
});

test.each([
  ["single", "bun run ./src/app.ts"],
  ["monorepo", "bun run apps/server/src/app.ts"],
] as const)("hono defines a root start script (%s)", async (layout, expected) => {
  const { plan } = expectBuilt(await buildSelection(["hono"], { layout }));
  expect(packageJson(plan.vfs.read("package.json"))["scripts"]).toMatchObject({ start: expected });
});

test("hono monorepo is a real workspace", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono"], { layout: "monorepo" }));
  expect(packageJson(plan.vfs.read("package.json"))["workspaces"]).toEqual(["apps/server"]);
  expect(packageJson(plan.vfs.read("apps/server/package.json"))).toMatchObject({
    name: "server",
    private: true,
  });
  const single = expectBuilt(await buildSelection(["hono"]));
  expect(packageJson(single.plan.vfs.read("package.json"))["workspaces"]).toBeUndefined();
});

test("hono keeps middleware and routes as top-level declarations", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono"]));
  const source = String(plan.vfs.read("src/app.ts"));
  expect(source).toMatch(/^export const middleware\b/m);
  expect(source).toMatch(/^export const routes\b/m);
  expect(source).not.toContain("{{");
});

test("hono records server and api:http in the Lockfile", async () => {
  const { lockfile } = expectBuilt(await buildSelection(["hono"]));
  expect(Object.keys(lockfile.modules)).toEqual(["hono"]);
  expect(Object.keys(lockfile.files)).toEqual([
    ".claude/skills/hono-add-route/SKILL.md",
    "AGENTS.md",
    "CLAUDE.md",
    "package.json",
    "src/app.ts",
  ]);
});

test("hono monorepo Dockerfile installs with every workspace manifest on disk", async () => {
  const { plan } = expectBuilt(await buildSelection(["hono", "docker"], { layout: "monorepo" }));
  const dockerfile = String(plan.vfs.read("Dockerfile"));
  expect(dockerfile.indexOf("COPY . .")).toBeLessThan(dockerfile.indexOf("bun install"));
});
