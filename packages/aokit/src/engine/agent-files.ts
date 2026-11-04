import { aokitCommandLines } from "../mcp/guidance/static.ts";
import { upsertRegion } from "../patchers/markdown/regions.ts";
import { type LayoutName, layoutTables } from "./layout.ts";
import type { OpVfs } from "./ops.ts";

/** The reserved pseudo-owner of the Agent files' header and `CLAUDE.md` Regions. */
export const coreOwner = "aokit";

const agentsPath = "AGENTS.md";
const claudePath = "CLAUDE.md";
const headerRegionId = `${coreOwner}:header`;
const claudeRegionId = `${coreOwner}:claude`;

function targetTable(layout: LayoutName): string {
  const rows = Object.entries(layoutTables[layout]).map(
    ([target, directory]) =>
      [`\`${target}\``, `\`${directory === "" ? "." : directory}\``] as const,
  );
  const header = ["Target", "Path"] as const;
  const widths = [0, 1].map((column) =>
    Math.max(header[column]?.length ?? 0, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const line = (cells: readonly string[]): string =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ")} |`;
  const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [line(header), divider, ...rows.map((row) => line(row))].join("\n");
}

function commandList(): string {
  return aokitCommandLines
    .map(([command, description]) => `- \`${command}\`: ${description}`)
    .join("\n");
}

/** The body of the `aokit:header` Region for a Layout, authored in Oxfmt style. */
export function renderHeader(layout: LayoutName): string {
  return [
    "# Agent guide",
    "",
    "This Project was generated and is kept up to date by aokit. Extend it with aokit instead of editing generated files by hand.",
    "",
    "## Layout",
    "",
    `This Project uses the \`${layout}\` Layout. Each Target resolves to this path:`,
    "",
    targetTable(layout),
    "",
    "## Commands",
    "",
    commandList(),
    "",
    "Do not edit inside aokit markers (`<!-- aokit:begin ... -->` to `<!-- aokit:end ... -->`): aokit rewrites those Regions. Write your own notes outside them.",
  ].join("\n");
}

/**
 * Writes the Agent files every Render contains: `AGENTS.md` with the `aokit:header` Region on
 * top and `CLAUDE.md` with the `aokit:claude` Region that imports `AGENTS.md`.
 */
export function writeAgentFiles(vfs: OpVfs, layout: LayoutName): void {
  const agents = upsertRegion(
    String(vfs.read(agentsPath) ?? ""),
    { id: headerRegionId, content: renderHeader(layout) },
    "top",
  );
  vfs.write(agentsPath, agents, { ownership: "managed" });
  const claude = upsertRegion(
    String(vfs.read(claudePath) ?? ""),
    { id: claudeRegionId, content: "@AGENTS.md" },
    "top",
  );
  vfs.write(claudePath, claude, { ownership: "managed" });
}
