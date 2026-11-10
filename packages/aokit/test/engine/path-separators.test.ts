import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EngineContext, Vfs, buildPlan } from "../../src/engine/index.ts";
import { normalizeProjectPath } from "../../src/engine/vfs.ts";
import { assembleLockfile } from "../../src/pipeline/assemble.ts";

const context: EngineContext = { now: new Date(0), random: () => 0.5, env: {} };
const registry = { name: "official", source: "x", release: "2026.11.2", minCliVersion: "0.0.0" };

test.each([
  [String.raw`src\lib\a.ts`, "src/lib/a.ts"],
  [String.raw`.\src\a.ts`, "src/a.ts"],
  [String.raw`src/lib\a.ts`, "src/lib/a.ts"],
])("a backslash path %s normalizes to the / key %s", (input, key) => {
  expect(normalizeProjectPath(input)).toBe(key);
});

test.each([
  String.raw`C:\project\a.ts`,
  "C:/project/a.ts",
  "c:a.ts",
  String.raw`\\server\share\a.ts`,
])("a Windows absolute path %s is rejected", (input) => {
  expect(() => normalizeProjectPath(input)).toThrow(`Invalid file path "${input}".`);
});

test("VFS keys written with backslashes are stored and listed with /", () => {
  const vfs = Vfs.empty();
  vfs.write(String.raw`src\lib\a.ts`, "a\r\n");
  expect(vfs.paths()).toEqual(["src/lib/a.ts"]);
  expect(vfs.read("src/lib/a.ts")).toBe("a\n");
  expect(vfs.has(String.raw`src\lib\a.ts`)).toBe(true);
});

test("Lockfile file keys stay / when the VFS was written with backslashes", async () => {
  const plan = await buildPlan({ modules: [], layout: "single", answers: {}, context });
  const vfs = Vfs.empty();
  vfs.write(String.raw`src\lib\a.ts`, "export {};\n");
  const lockfile = assembleLockfile({
    plan: { ...plan, vfs },
    modules: [],
    layout: "single",
    registry,
    deps: {},
    previousFiles: {
      "src/lib/a.ts": { owners: ["solo"], mode: "managed", hash: `sha256-${"0".repeat(64)}` },
    },
  });
  expect(Object.keys(lockfile.files)).toEqual(["src/lib/a.ts"]);
  expect(Object.keys(lockfile.files).some((key) => key.includes("\\"))).toBe(false);
});

test("a VFS loaded from a nested directory keys files with /", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-separators-"));
  try {
    await mkdir(join(directory, "src", "lib"), { recursive: true });
    await writeFile(join(directory, "src", "lib", "a.ts"), "export {};\n");
    const vfs = await Vfs.fromDirectory(directory);
    expect(vfs.paths()).toEqual(["src/lib/a.ts"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
