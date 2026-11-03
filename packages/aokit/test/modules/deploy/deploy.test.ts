import { expect, test } from "bun:test";
import { buildSelection, expectBuilt } from "./support.ts";

test.each(["single", "monorepo"] as const)(
  "docker alone writes its root files (%s)",
  async (layout) => {
    const { plan } = expectBuilt(await buildSelection(["docker"], { layout }));
    expect(plan.vfs.paths()).toEqual([".dockerignore", "Dockerfile"]);
    expect(String(plan.vfs.read("Dockerfile"))).toContain("FROM oven/bun");
    expect(String(plan.vfs.read(".dockerignore"))).toContain("node_modules");
  },
);

test.each(["single", "monorepo"] as const)(
  "coolify with docker writes root files only (%s)",
  async (layout) => {
    const { plan } = expectBuilt(await buildSelection(["docker", "coolify"], { layout }));
    expect(plan.vfs.paths()).toEqual([
      ".dockerignore",
      "Dockerfile",
      "docker-compose.coolify.yaml",
    ]);
    expect(plan.vfs.has("package.json")).toBe(false);
  },
);

test("docker and coolify are two deploy providers", async () => {
  const { lockfile } = expectBuilt(await buildSelection(["docker", "coolify"]));
  expect(Object.keys(lockfile.modules).toSorted()).toEqual(["coolify", "docker"]);
});

test("coolify alone fails with the missing container error suggesting docker", async () => {
  const result = await buildSelection(["coolify"]);
  if (result.ok) throw new Error("expected a resolution failure");
  expect(result.error.code).toBe("requirement_unmet");
  expect(result.error.message).toContain('requires capability "container"');
  expect(result.error.message).toContain("docker");
  expect(result.error.fix).toContain("aokit add docker");
});
