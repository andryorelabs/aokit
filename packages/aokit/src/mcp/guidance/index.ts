import { errorCodeExitCodes, exitCodes } from "../../cli/exit-codes.ts";
import { layoutTables } from "../../engine/layout.ts";
import type { Registry } from "../../registry/index.ts";
import { staticGuidance } from "./static.ts";

/** The guidance topics `get_guidance` accepts. */
export const guidanceTopics = ["overview", "workflow", "modules", "layouts", "errors"] as const;

export type GuidanceTopic = (typeof guidanceTopics)[number];

const categoryOfExitCode: Readonly<Record<number, string>> = {
  [exitCodes.success]: "success",
  [exitCodes.failure]: "failure",
  [exitCodes.outcome]: "outcome",
  [exitCodes.usage]: "usage",
  [exitCodes.resolution]: "resolution",
  [exitCodes.precondition]: "precondition",
  [exitCodes.mergeConflicts]: "merge conflicts",
  [exitCodes.interrupted]: "interrupted",
};

function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");
}

function byName(left: readonly [string, unknown], right: readonly [string, unknown]): number {
  return left[0] < right[0] ? -1 : 1;
}

function modulesTable(registry: Registry): string {
  const rows = Object.entries(registry.index.modules)
    .toSorted(byName)
    .map(([name, entry]) => {
      const provides = entry.versions[entry.latest]?.provides ?? [];
      return [`\`${name}\``, entry.latest, provides.map((item) => `\`${item}\``).join(", ")];
    });
  return table(["Module", "Version", "Provides"], rows);
}

function layoutsTable(): string {
  const rows = Object.entries(layoutTables).map(([layout, targets]) => [
    `\`${layout}\``,
    Object.entries(targets)
      .map(([target, path]) => `\`${target}\` = \`${path === "" ? "." : path}\``)
      .join(", "),
  ]);
  return table(["Layout", "Targets"], rows);
}

function errorsTable(): string {
  const rows = Object.entries(errorCodeExitCodes)
    .toSorted(byName)
    .map(([code, exitCode]) => [
      `\`${code}\``,
      categoryOfExitCode[exitCode] ?? "failure",
      String(exitCode),
    ]);
  return table(["Code", "Category", "Exit code"], rows);
}

/**
 * Renders the guidance markdown of a topic: bundled static text, plus a table generated from the
 * Registry (`modules`), the Layout list (`layouts`) or the exit-code table (`errors`).
 */
export function renderGuidance(topic: GuidanceTopic, registry: Registry): string {
  const text = staticGuidance[topic];
  if (topic === "modules") return `${text}\n${modulesTable(registry)}\n`;
  if (topic === "layouts") return `${text}\n${layoutsTable()}\n`;
  if (topic === "errors") return `${text}\n${errorsTable()}\n`;
  return text;
}
