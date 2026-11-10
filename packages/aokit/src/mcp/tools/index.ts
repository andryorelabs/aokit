import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { CommandContext } from "../../cli/command.ts";
import type { Envelope } from "../../cli/envelope.ts";
import type { PlanSession } from "../plan-id.ts";
import { getGuidanceTool } from "./guidance.ts";
import { listTool } from "./list.ts";
import { addTool, planAddTool } from "./plan-add.ts";
import { createTool, planTool } from "./plan-create.ts";
import { getSchemaTool } from "./schema.ts";

/**
 * One MCP tool: its input is derived from a command schema by `toExplicitInput`, and `run` goes
 * through `runCommand` with the server's non-interactive context.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  input: z.ZodObject;
  annotations: ToolAnnotations;
  run(session: PlanSession, input: unknown, context: CommandContext): Promise<Envelope>;
}

/** Every tool the MCP server registers, in listing order. */
export const mcpTools: McpToolDefinition[] = [
  getGuidanceTool,
  getSchemaTool,
  listTool,
  planTool,
  createTool,
  planAddTool,
  addTool,
];
