import { describe, expect, test } from "bun:test";
import type { FileContent } from "../../src/engine/vfs.ts";
import { mergeProject } from "../../src/merge/index.ts";
import { createMerger } from "../../src/merger/index.ts";
import { builtOf, driftOf, lockfileOf, vfsOf, type FixtureFiles } from "./harness.ts";

interface Scenario {
  readonly base: FixtureFiles;
  readonly next: FixtureFiles;
  readonly user: Record<string, FileContent>;
  readonly renames?: Record<string, string>;
  readonly withoutPlannedChanges?: boolean;
}

function run(scenario: Scenario) {
  const built = builtOf(scenario.next);
  const next = scenario.withoutPlannedChanges
    ? { ...built, plan: { ...built.plan, changes: [] } }
    : built;
  return mergeProject({
    base: vfsOf(scenario.base),
    next,
    readUser: (path) => Promise.resolve(scenario.user[path]),
    lockfile: lockfileOf(scenario.base),
    merger: createMerger(),
    driftOf,
    renames: new Map(Object.entries(scenario.renames ?? {})),
  });
}

describe("mergeProject gaps", () => {
  test("a new seed that already exists in the project is kept with a warning", async () => {
    const result = await run({
      base: {},
      next: { "seed.md": { content: "fresh\n", ownership: "seed" } },
      user: { "seed.md": "mine\n" },
    });
    expect(result.plan.changes).toEqual([]);
    expect(result.warnings).toEqual([
      "seed.md already exists and was kept instead of being replaced by the new seed.",
    ]);
    expect(result.lockfile.files["seed.md"]).toBeDefined();
  });

  test("a new seed that does not exist yet is written", async () => {
    const result = await run({
      base: {},
      next: { "seed.md": { content: "fresh\n", ownership: "seed" } },
      user: {},
    });
    expect(result.plan.changes.map((change) => [change.type, change.path])).toEqual([
      ["create", "seed.md"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("a volatile file the user does not have is written from next", async () => {
    const result = await run({
      base: {},
      next: { ".env": { content: "TOKEN=1\n", volatile: true } },
      user: {},
    });
    expect(result.plan.changes.map((change) => [change.type, change.path, change.content])).toEqual(
      [["create", ".env", "TOKEN=1\n"]],
    );
  });

  test("a volatile file the user already has is kept", async () => {
    const result = await run({
      base: { ".env": { content: "TOKEN=1\n", volatile: true } },
      next: { ".env": { content: "TOKEN=2\n", volatile: true } },
      user: { ".env": "TOKEN=mine\n" },
    });
    expect(result.plan.changes).toEqual([]);
  });

  test("a rename the Plan does not list takes its Provenance from the Lockfile owners", async () => {
    const result = await run({
      base: { "src/routes.tsx": "one\n" },
      next: { "src/router.tsx": "one\n" },
      user: { "src/routes.tsx": "one\n" },
      renames: { "src/routes.tsx": "src/router.tsx" },
      withoutPlannedChanges: true,
    });
    const [change] = result.plan.changes;
    expect(change?.type).toBe("rename");
    expect(change?.provenance).toEqual([
      { module: "mod", entry: { kind: "file", from: "src/router.tsx" } },
    ]);
  });
});
