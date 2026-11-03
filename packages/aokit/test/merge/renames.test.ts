import { describe, expect, test } from "bun:test";
import type { FileContent } from "../../src/engine/vfs.ts";
import { composeRenames, mergeProject } from "../../src/merge/index.ts";
import { createMerger } from "../../src/merger/index.ts";
import { builtOf, driftOf, hashOf, lockfileOf, vfsOf, type FixtureFiles } from "./harness.ts";

interface Scenario {
  readonly base: FixtureFiles;
  readonly next: FixtureFiles;
  readonly user: Record<string, FileContent>;
  readonly renames?: Record<string, string>;
  readonly ejected?: Record<string, "ejected">;
}

function run(scenario: Scenario) {
  return mergeProject({
    base: vfsOf(scenario.base),
    next: builtOf(scenario.next),
    readUser: async (path) => scenario.user[path],
    lockfile: lockfileOf(scenario.base, scenario.ejected),
    merger: createMerger(),
    driftOf,
    renames: new Map(Object.entries(scenario.renames ?? {})),
  });
}

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;
const routesToRouter = { "src/routes.tsx": "src/router.tsx" };

describe("mergeProject renames", () => {
  test("an edited file moves and merges the user's edit with the new Render", async () => {
    const result = await run({
      base: { "src/routes.tsx": lines("a", "b", "c", "d", "e", "f") },
      next: { "src/router.tsx": lines("a", "b", "c", "d", "e", "F") },
      user: { "src/routes.tsx": lines("A", "b", "c", "d", "e", "f") },
      renames: routesToRouter,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.plan.changes).toHaveLength(1);
    const [change] = result.plan.changes;
    expect(change?.type).toBe("rename");
    expect(change?.path).toBe("src/router.tsx");
    expect(change?.renamedFrom).toBe("src/routes.tsx");
    expect(change?.content).toBe(lines("A", "b", "c", "d", "e", "F"));
    expect(result.vfs.has("src/routes.tsx")).toBe(false);
  });

  test("the Lockfile entry moves to the new path", async () => {
    const result = await run({
      base: { "src/routes.tsx": "one\n" },
      next: { "src/router.tsx": "two\n" },
      user: { "src/routes.tsx": "one\n" },
      renames: routesToRouter,
    });
    expect(result.lockfile.files["src/routes.tsx"]).toBeUndefined();
    expect(result.lockfile.files["src/router.tsx"]?.hash).toBe(hashOf("two\n"));
    expect(result.plan.changes.map((c) => c.type)).toEqual(["rename"]);
  });

  test("an unchanged Render still moves the user's file", async () => {
    const result = await run({
      base: { "src/routes.tsx": "same\n" },
      next: { "src/router.tsx": "same\n" },
      user: { "src/routes.tsx": "mine\n" },
      renames: routesToRouter,
    });
    expect(result.conflicts).toEqual([]);
    expect(result.plan.changes.map((c) => [c.type, c.path, c.content])).toEqual([
      ["rename", "src/router.tsx", "mine\n"],
    ]);
  });

  test("without a manifest a move stays delete plus create", async () => {
    const result = await run({
      base: { "src/routes.tsx": "one\n" },
      next: { "src/router.tsx": "two\n" },
      user: { "src/routes.tsx": "one\n" },
    });
    expect(result.plan.changes.map((c) => `${c.type} ${c.path}`)).toEqual([
      "create src/router.tsx",
      "delete src/routes.tsx",
    ]);
  });

  test("a rename whose old path the user deleted writes nothing and moves the entry", async () => {
    const result = await run({
      base: { "src/routes.tsx": "one\n" },
      next: { "src/router.tsx": "two\n" },
      user: {},
      renames: routesToRouter,
    });
    expect(result.plan.changes).toEqual([]);
    expect(result.vfs.has("src/router.tsx")).toBe(false);
    expect(result.lockfile.files["src/router.tsx"]).toBeDefined();
    expect(result.lockfile.files["src/routes.tsx"]).toBeUndefined();
  });

  test("an unknown user file at the new path raises a Conflict", async () => {
    const result = await run({
      base: { "src/routes.tsx": "one\n" },
      next: { "src/router.tsx": "two\n" },
      user: { "src/routes.tsx": "one\n", "src/router.tsx": "theirs\n" },
      renames: routesToRouter,
    });
    expect(result.conflicts.map((c) => c.path)).toEqual(["src/router.tsx"]);
    expect(result.plan.changes.map((c) => c.type)).toEqual(["delete"]);
  });

  test("an ejected file on a renamed path stays at the old path", async () => {
    const result = await run({
      base: { "src/routes.tsx": "one\n" },
      next: { "src/router.tsx": "two\n" },
      user: { "src/routes.tsx": "mine\n" },
      renames: routesToRouter,
      ejected: { "src/routes.tsx": "ejected" },
    });
    expect(result.plan.changes.map((c) => `${c.type} ${c.path}`)).toEqual([
      "create src/router.tsx",
    ]);
    expect(result.vfs.read("src/routes.tsx")).toBe("mine\n");
    expect(result.lockfile.files["src/routes.tsx"]?.mode).toBe("ejected");
  });

  test("a conflicting rename removes the old path and keeps the previous hash", async () => {
    const result = await run({
      base: { "src/routes.tsx": "x\n" },
      next: { "src/router.tsx": "n\n" },
      user: { "src/routes.tsx": "u\n" },
      renames: routesToRouter,
    });
    expect(result.conflicts.map((c) => c.path)).toEqual(["src/router.tsx"]);
    expect(result.plan.changes.map((c) => `${c.type} ${c.path}`)).toEqual([
      "delete src/routes.tsx",
    ]);
    expect(result.lockfile.files["src/router.tsx"]?.hash).toBe(hashOf("x\n"));
  });
});

describe("composeRenames", () => {
  test("chains a to b then b to c into a to c", () => {
    expect([...composeRenames([{ a: "b" }, { b: "c" }])]).toEqual([["a", "c"]]);
  });

  test("keeps independent renames and applies them in version order", () => {
    const composed = composeRenames([{ a: "b", x: "y" }, { b: "c" }, { y: "z" }]);
    expect(Object.fromEntries(composed)).toEqual({ a: "c", x: "z" });
  });

  test("drops a path that returns to where it started", () => {
    expect(composeRenames([{ a: "b" }, { b: "a" }]).size).toBe(0);
  });

  test("an empty list composes to an empty map", () => {
    expect(composeRenames([]).size).toBe(0);
  });
});

describe("mergeProject binary renames", () => {
  test("a binary changed on both sides keeps the user's bytes at the new path", async () => {
    const original = new Uint8Array([0, 1, 2, 3]);
    const edited = new Uint8Array([0, 9, 9, 9]);
    const incoming = new Uint8Array([0, 5, 5, 5]);
    const result = await run({
      base: { "assets/logo.png": original },
      next: { "assets/brand.png": incoming },
      user: { "assets/logo.png": edited },
      renames: { "assets/logo.png": "assets/brand.png" },
    });
    expect(result.conflicts).toHaveLength(1);
    const change = result.plan.changes.find((candidate) => candidate.path === "assets/brand.png");
    expect(change).toMatchObject({ type: "rename", renamedFrom: "assets/logo.png" });
    expect(change?.content).toEqual(edited);
  });
});
