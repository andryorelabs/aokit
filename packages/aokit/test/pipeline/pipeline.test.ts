import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLockfile } from "../../src/lockfile/index.ts";
import { buildProject, runPipeline } from "../../src/pipeline/index.ts";
import { fixtureModules, input } from "./fixtures.ts";

test.each(["single", "monorepo"] as const)(
  "builds and applies a fixture selection (%s)",
  async (layout) => {
    const parent = await mkdtemp(join(tmpdir(), "aokit-pipeline-"));
    try {
      const directory = join(parent, "project");
      const result = await runPipeline(input({ layout }), directory);
      if (!result.ok) throw new Error(result.error.message);

      const webDirectory = layout === "single" ? "src" : "apps/web";
      const app = await readFile(join(directory, webDirectory, "app.ts"), "utf8");
      expect(app).toBe("export const name = 'demo';\n");
      const providers = await readFile(join(directory, webDirectory, "providers.ts"), "utf8");
      expect(providers).toContain('import { Auth } from "auth";');
      expect(providers).toContain("Auth()");
      expect(await readFile(join(directory, "demo.md"), "utf8")).toBe("# demo\n");

      const lockfile = parseLockfile(
        await readFile(join(directory, "aokit.lock.json"), "utf8"),
      ).lockfile;
      expect(await readFile(join(directory, "aokit.lock.json"), "utf8")).toBe(result.lockfileText);
      expect(lockfile.layout).toBe(layout);
      expect(Object.keys(lockfile.modules)).toEqual(["auth", "base"]);
      expect(lockfile.modules["base"]?.answers).toEqual({ appName: "demo" });
      expect(lockfile.files["demo.md"]).toMatchObject({ owners: ["base"], mode: "seed" });
      expect(lockfile.files["run.sh"]).toBeDefined();
      expect(lockfile.files[`${webDirectory}/providers.ts`]?.owners).toEqual(["auth", "base"]);
      expect(lockfile.files[`${webDirectory}/.env`]?.owners).toEqual(["auth", "base"]);
      expect(lockfile.deps["oxlint"]).toEqual({
        version: "1.90.0",
        pinned: true,
        source: "catalog",
      });
      expect(lockfile.deps["next"]).toEqual({
        version: "^16.0.0",
        pinned: false,
        source: "catalog",
      });
      expect(lockfile.deps["zod"]?.source).toBe("catalog");

      const rootPackage = await readFile(join(directory, "package.json"), "utf8");
      const webPackage = await readFile(
        join(directory, webDirectory, "package.json"),
        "utf8",
      ).catch(() => rootPackage);
      expect(webPackage).toContain(
        layout === "single" ? '"next": "^16.0.0"' : '"next": "catalog:"',
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  },
);

test.each(["single", "monorepo"] as const)(
  "building twice gives one Plan hash and Lockfile (%s)",
  async (layout) => {
    const first = await buildProject(input({ layout, selection: ["auth", "base"] }));
    const second = await buildProject(input({ layout, selection: ["base", "auth"] }));
    if (!first.ok || !second.ok) throw new Error("expected success");
    expect(second.plan.hash).toBe(first.plan.hash);
    expect(second.lockfileText).toBe(first.lockfileText);
    expect(first.plan.hash).toMatch(/^[0-9a-f]{64}$/);
  },
);

test("a resolution error returns its code before any VFS work", async () => {
  const failing = input({
    selection: ["auth"],
    available: fixtureModules().filter((module) => module.manifest.name === "auth"),
    opHandlers: new Map([
      [
        "addImport",
        () => {
          throw new Error("VFS work must not start");
        },
      ],
    ]),
  });
  const result = await buildProject(failing);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe("requirement_unmet");
  expect(result.error.fix.length).toBeGreaterThan(0);
});

test("a resolution error leaves the target directory untouched", async () => {
  const parent = await mkdtemp(join(tmpdir(), "aokit-pipeline-"));
  try {
    const directory = join(parent, "project");
    const result = await runPipeline(input({ selection: ["missing"] }), directory);
    expect(result.ok).toBe(false);
    expect(await Bun.file(join(directory, "aokit.lock.json")).exists()).toBe(false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
