import { describe, expect, test } from "bun:test";
import { runCommand, type CommandContext } from "../../src/cli/command.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { schemaCommand } from "../../src/cli/commands/schema.ts";
import type { PlanChange } from "../../src/engine/plan.ts";
import { unifiedDiff } from "../../src/project/diff.ts";

function change(partial: Partial<PlanChange> & Pick<PlanChange, "type" | "path">): PlanChange {
  return { ownership: "managed", mode: undefined, provenance: [], ...partial };
}

describe("unifiedDiff", () => {
  test("a create diffs against /dev/null", () => {
    const text = unifiedDiff({
      changes: [change({ type: "create", path: "a.txt", content: "one\ntwo\n" })],
    });
    expect(text).toBe("--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n");
  });

  test("an update shows real hunks with context", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n") + "\n";
    const after = before.replace("5\n", "five\n");
    const text = unifiedDiff({
      changes: [change({ type: "update", path: "n.txt", previousContent: before, content: after })],
    });
    expect(text).toContain("--- a/n.txt\n+++ b/n.txt\n@@ -2,7 +2,7 @@");
    expect(text).toContain("-5\n+five\n");
    expect(text).toContain(" 4\n");
  });

  test("a delete shows removed lines against /dev/null", () => {
    const text = unifiedDiff({
      changes: [change({ type: "delete", path: "gone.txt", previousContent: "x\ny\n" })],
    });
    expect(text).toBe("--- a/gone.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-x\n-y\n");
  });

  test("a rename shows both names and the content change", () => {
    const text = unifiedDiff({
      changes: [
        change({
          type: "rename",
          path: "new.txt",
          renamedFrom: "old.txt",
          previousContent: "a\n",
          content: "b\n",
        }),
      ],
    });
    expect(text).toBe("--- a/old.txt\n+++ b/new.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n");
  });

  test("a pure rename shows headers only and binary content is summarized", () => {
    const pure = unifiedDiff({
      changes: [
        change({
          type: "rename",
          path: "n",
          renamedFrom: "o",
          previousContent: "same\n",
          content: "same\n",
        }),
      ],
    });
    expect(pure).toBe("--- a/o\n+++ b/n\n");
    const binary = unifiedDiff({
      changes: [change({ type: "create", path: "b.bin", content: new Uint8Array([1, 2, 3]) })],
    });
    expect(binary).toBe("--- /dev/null\n+++ b/b.bin\nBinary file (3 bytes)\n");
  });
});

describe("lifecycle commands", () => {
  const context: CommandContext = { version: "0.0.0", env: {}, commands: exposedCommands };

  test("aokit schema lists the implemented lifecycle commands", async () => {
    const names = JSON.stringify(await runCommand(schemaCommand, context, {}));
    for (const name of ["doctor", "diff", "check", "eject", "restore", "add", "remove", "recopy"]) {
      expect(names).toContain(`"name":"${name}"`);
    }
  });
});
