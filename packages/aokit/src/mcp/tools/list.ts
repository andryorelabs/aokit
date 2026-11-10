import { runCommand, type CommandContext } from "../../cli/command.ts";
import { listCommand } from "../../cli/commands/list.ts";
import type { Envelope } from "../../cli/envelope.ts";
import { fromExplicitInput, toExplicitInput } from "../explicit-input.ts";
import type { PlanSession } from "../plan-id.ts";
import type { McpToolDefinition } from "./index.ts";

const listToolInput = toExplicitInput(listCommand.input);

export const listTool: McpToolDefinition = {
  name: "list",
  description:
    "List every Module of a Registry (the bundled one when `registry` is null) with its latest version, description and the Capabilities it provides. Read-only.",
  input: listToolInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  run(_session: PlanSession, input: unknown, context: CommandContext): Promise<Envelope> {
    const explicit = listToolInput.parse(input);
    return runCommand(listCommand, context, fromExplicitInput(explicit));
  },
};
