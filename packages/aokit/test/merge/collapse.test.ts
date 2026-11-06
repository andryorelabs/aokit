import { describe, expect, test } from "bun:test";
import { mergeProject } from "../../src/merge/index.ts";
import { createMerger } from "../../src/merger/index.ts";
import { builtOf, driftOf, lockfileOf, vfsOf } from "./harness.ts";

describe("mergeProject when several paths collapse onto one", () => {
  test("two edited files that collapse onto one path are never silently reduced to one", async () => {
    const base = {
      "apps/web/tsconfig.json": "web original\n",
      "apps/api/tsconfig.json": "api original\n",
    };
    const user: Record<string, string> = {
      "apps/web/tsconfig.json": "web edit\n",
      "apps/api/tsconfig.json": "api edit\n",
    };
    const result = await mergeProject({
      base: vfsOf(base),
      next: builtOf({ "tsconfig.json": "collapsed\n" }),
      readUser: async (path) => user[path],
      lockfile: lockfileOf(base),
      merger: createMerger(),
      driftOf,
    });
    const keptEdits = ["apps/web/tsconfig.json", "apps/api/tsconfig.json"].filter((path) =>
      result.vfs.has(path),
    );
    expect(keptEdits).toHaveLength(2);
    expect(result.warnings.length + result.conflicts.length).toBeGreaterThanOrEqual(2);
  });
});
