import { structuredPatch } from "diff";
import type { Plan, PlanChange } from "../engine/plan.ts";
import type { FileContent } from "../engine/vfs.ts";

const contextLines = 3;

function isBinary(...contents: readonly (FileContent | undefined)[]): boolean {
  return contents.some((content) => content !== undefined && typeof content !== "string");
}

function byteLength(content: FileContent | undefined): number {
  if (content === undefined) {
    return 0;
  }
  return typeof content === "string" ? new TextEncoder().encode(content).length : content.length;
}

function headerFor(change: PlanChange): string {
  const oldName = change.type === "create" ? "/dev/null" : `a/${change.renamedFrom ?? change.path}`;
  const newName = change.type === "delete" ? "/dev/null" : `b/${change.path}`;
  return `--- ${oldName}\n+++ ${newName}\n`;
}

function renderHunks(change: PlanChange): string {
  const before = typeof change.previousContent === "string" ? change.previousContent : "";
  const after = typeof change.content === "string" ? change.content : "";
  const patch = structuredPatch(change.path, change.path, before, after, undefined, undefined, {
    context: contextLines,
  });
  return patch.hunks
    .map((hunk) => {
      const oldStart = hunk.oldLines === 0 ? hunk.oldStart - 1 : hunk.oldStart;
      const newStart = hunk.newLines === 0 ? hunk.newStart - 1 : hunk.newStart;
      const heading = `@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@\n`;
      return heading + hunk.lines.map((line) => `${line}\n`).join("");
    })
    .join("");
}

function diffOne(change: PlanChange): string {
  const header = headerFor(change);
  if (isBinary(change.content, change.previousContent)) {
    const size = byteLength(change.content ?? change.previousContent);
    return `${header}Binary file (${size} bytes)\n`;
  }
  return header + renderHunks(change);
}

/**
 * Unified diff of every change in a Plan. Creates diff against nothing, deletes against nothing,
 * updates and renames show line hunks; binary files and pure renames show their header only.
 */
export function unifiedDiff(plan: Pick<Plan, "changes">): string {
  return plan.changes.map(diffOne).join("\n");
}
