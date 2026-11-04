import { isDeepStrictEqual } from "node:util";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { mergeJsonc, type JsoncValue } from "../../patchers/jsonc/index.ts";

/** The MCP clients `mcp init` can register the server in. */
export const mcpClients = ["claude", "cursor", "vscode", "codex"] as const;

export type McpClient = (typeof mcpClients)[number];

/** Name the server is registered under in every client. */
const serverName = "aokit";

/** A client config that is not valid JSONC, or whose root is not an object. */
export class InvalidClientConfigError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`${path} is not valid JSONC: ${detail}`);
    this.name = "InvalidClientConfigError";
  }
}

/** Where and how a JSON-config client stores the server. */
export interface JsonClientLayout {
  readonly path: string;
  readonly key: "mcpServers" | "servers";
  readonly entry: { [key: string]: JsoncValue };
}

function stdioEntry(): { [key: string]: JsoncValue } {
  return { command: "bunx", args: ["aokit", "mcp"] };
}

/** Where and how each JSON-config client stores the server; `codex` has none. */
export function jsonClientLayout(client: McpClient): JsonClientLayout | null {
  switch (client) {
    case "claude":
      return { path: ".mcp.json", key: "mcpServers", entry: stdioEntry() };
    case "cursor":
      return { path: ".cursor/mcp.json", key: "mcpServers", entry: stdioEntry() };
    case "vscode":
      return {
        path: ".vscode/mcp.json",
        key: "servers",
        entry: { type: "stdio", ...stdioEntry() },
      };
    case "codex":
      return null;
    default:
      return null;
  }
}

/** The `claude mcp add` command, printed instead of writing `.mcp.json`. */
export const claudeAddInstructions = `claude mcp add ${serverName} -- bunx aokit mcp`;

/** The `~/.codex/config.toml` block that registers the server. */
export const codexTomlBlock = `[mcp_servers.${serverName}]\ncommand = "bunx"\nargs = ["aokit", "mcp"]\n`;

function parseConfig(path: string, text: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new InvalidClientConfigError(path, `parse error at offset ${errors[0]?.offset ?? 0}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/**
 * Registers the aokit server in JSONC config text without touching other servers or comments.
 * On an existing `aokit` entry only the fields aokit owns (`command`, `args`, `type`) are set, so
 * keys the user added, such as `env`, stay.
 */
export function registerServer(path: string, text: string, layout: JsonClientLayout): string {
  const current = text.trim() === "" ? {} : parseConfig(path, text);
  const root = asRecord(current);
  if (root === null) throw new InvalidClientConfigError(path, "the root must be an object");
  const existing = asRecord(asRecord(root[layout.key])?.[serverName]);
  if (existing === null) {
    return mergeJsonc(text, { [layout.key]: { [serverName]: layout.entry } });
  }
  let result = text;
  for (const [field, value] of Object.entries(layout.entry)) {
    if (isDeepStrictEqual(existing[field], value)) continue;
    const edits = modify(result, [layout.key, serverName, field], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
    });
    result = applyEdits(result, edits);
  }
  return result;
}
