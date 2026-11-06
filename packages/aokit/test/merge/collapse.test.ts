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
      renames: new Map([
        ["apps/web/tsconfig.json", "tsconfig.json"],
        ["apps/api/tsconfig.json", "tsconfig.json"],
      ]),
    });
    const conflict = result.conflicts.find((entry) => entry.path === "tsconfig.json");
    expect(conflict?.user).toBe("web edit\n");
    expect(result.vfs.has("apps/api/tsconfig.json")).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("apps/api/tsconfig.json"))).toBe(
      true,
    );
  });
});
