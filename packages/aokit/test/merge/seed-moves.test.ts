import { describe, expect, test } from "bun:test";
import type { FileContent } from "../../src/engine/vfs.ts";
import { mergeProject } from "../../src/merge/index.ts";
import { createMerger } from "../../src/merger/index.ts";
import { builtOf, driftOf, lockfileOf, vfsOf, type FixtureFiles } from "./harness.ts";

const seed = (content: string) => ({ content, ownership: "seed" as const });

function run(user: Record<string, FileContent>, nextFiles?: FixtureFiles) {
  const base = { "src/seed.ts": seed("original\n") };
  return mergeProject({
    base: vfsOf(base),
    next: builtOf(nextFiles ?? { "app/seed.ts": seed("fresh seed\n") }),
    readUser: (path) => Promise.resolve(user[path]),
    lockfile: lockfileOf(base),
    merger: createMerger(),
    driftOf,
    seedMoves: new Map([["src/seed.ts", "app/seed.ts"]]),
  });
}

describe("mergeProject seedMoves", () => {
  test("a seed moves with the user's current content, unmerged", async () => {
    const result = await run({ "src/seed.ts": "my edit\n" });
    expect(result.conflicts).toEqual([]);
    const [change] = result.plan.changes;
    expect(change?.type).toBe("rename");
    expect(change?.path).toBe("app/seed.ts");
    expect(change?.renamedFrom).toBe("src/seed.ts");
    expect(change?.content).toBe("my edit\n");
    expect(result.vfs.has("src/seed.ts")).toBe(false);
    expect(result.lockfile.files["app/seed.ts"]).toBeDefined();
    expect(result.lockfile.files["src/seed.ts"]).toBeUndefined();
  });

  test("an existing destination is a Conflict and nothing is overwritten", async () => {
    const result = await run({ "src/seed.ts": "my edit\n", "app/seed.ts": "already here\n" });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.path).toBe("app/seed.ts");
    expect(result.conflicts[0]?.next).toBe("my edit\n");
    expect(result.plan.changes).toEqual([]);
  });

  test("on a Conflict the old seed stays tracked and the destination is not recorded", async () => {
    const result = await run({ "src/seed.ts": "my edit\n", "app/seed.ts": "already here\n" });
    expect(result.vfs.has("src/seed.ts")).toBe(true);
    expect(result.lockfile.files["src/seed.ts"]).toBeDefined();
    expect(result.lockfile.files["app/seed.ts"]).toBeUndefined();
  });

  test("a seed the user deleted is not moved", async () => {
    const result = await run({});
    expect(result.plan.changes.map((change) => change.type)).not.toContain("rename");
  });
});
