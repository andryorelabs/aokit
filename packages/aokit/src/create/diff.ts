import type { PlanChange } from "../engine/plan.ts";

/** Unified diff of one created file against nothing; other change types name the change. */
export function unifiedDiff(change: PlanChange): string {
  if (change.type !== "create" || change.content === undefined) {
    return `--- a/${change.renamedFrom ?? change.path}\n+++ b/${change.path}\n`;
  }
  const header = `--- /dev/null\n+++ b/${change.path}\n`;
  if (typeof change.content !== "string") {
    return `${header}Binary file (${change.content.length} bytes)\n`;
  }
  const lines = change.content.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    return header;
  }
  return `${header}@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n`;
}
