import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LYCHEE_ARGS } from "./args";

const workflowPath = join(resolve(import.meta.dir, "../.."), ".github/workflows/lint-docs.yml");

/**
 * Extracts the lychee arguments from the workflow's `run:` line, e.g.
 * `.cache/lychee --offline ...`. Returns undefined when no such line exists.
 */
function workflowLycheeArgs(workflow: string): string[] | undefined {
  const match = /^\s*(?:run:\s*)?\S*lychee\S*\s+(--.*)$/m.exec(workflow);
  return match?.[1]?.trim().split(/\s+/);
}

describe("lint:docs argument parity", () => {
  test.skipIf(!existsSync(workflowPath))("local args equal lint-docs.yml args", () => {
    expect(workflowLycheeArgs(readFileSync(workflowPath, "utf8"))).toEqual([...LYCHEE_ARGS]);
  });

  test.skipIf(existsSync(workflowPath))(
    "skipped: .github/workflows/lint-docs.yml does not exist yet (a later ticket adds it)",
    () => {
      expect(LYCHEE_ARGS).toContain("--offline");
    },
  );

  test("local args are offline and check anchors only", () => {
    expect(LYCHEE_ARGS).toContain("--offline");
    expect(LYCHEE_ARGS).toContain("--include-fragments=anchor-only");
  });
});
