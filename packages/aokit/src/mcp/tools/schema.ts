import { z } from "zod";
import type { CommandContext } from "../../cli/command.ts";
import { addCommand } from "../../cli/commands/add.ts";
import { createCommand } from "../../cli/commands/create.ts";
import { removeCommand } from "../../cli/commands/remove.ts";
import { updateCommand } from "../../cli/commands/update.ts";
import { successEnvelope, type Envelope } from "../../cli/envelope.ts";
import { aokitMeta } from "../../cli/meta.ts";
import { layoutTables } from "../../engine/layout.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";
import { openRegistry, type Registry } from "../../registry/index.ts";
import { toExplicitInput } from "../explicit-input.ts";
import type { McpToolDefinition } from "./index.ts";

const schemaCommands = {
  create: createCommand,
  add: addCommand,
  remove: removeCommand,
  update: updateCommand,
};

const schemaToolInput = z.object({
  command: z
    .enum(["create", "add", "remove", "update"])
    .describe("The command whose explicit input schema to return"),
});

/** Opens the Registry that ships with the CLI, the default Registry of `create`. */
export function openDefaultRegistry(context: CommandContext): Promise<Registry> {
  return openRegistry(
    { kind: "bundled", path: bundledRegistryPath },
    { cliVersion: context.version },
  );
}

/**
 * The JSON Schema of an explicit input with the `x-aokit` meta of the command and of each field,
 * as `aokit schema` prints it for the CLI input.
 */
function explicitJsonSchema(
  explicit: z.ZodObject,
  name: string,
  description: string,
): Record<string, unknown> {
  const document = z.toJSONSchema(explicit, { io: "input" });
  document["x-aokit"] = { name, description };
  for (const [key, field] of Object.entries(explicit.shape)) {
    const meta = aokitMeta.get(field);
    const property = document.properties?.[key];
    if (meta !== undefined && typeof property === "object") property["x-aokit"] = meta;
  }
  return document;
}

async function modulesOf(registry: Registry): Promise<Record<string, unknown>[]> {
  const entries = Object.entries(registry.index.modules).toSorted(([left], [right]) =>
    left < right ? -1 : 1,
  );
  return Promise.all(
    entries.map(async ([name, entry]) => {
      const { manifest } = await registry.version(name, entry.latest);
      return {
        name,
        version: entry.latest,
        provides: manifest.provides.map((provided) => provided.capability),
        requires: manifest.requires,
        conflicts: manifest.conflicts,
      };
    }),
  );
}

export const getSchemaTool: McpToolDefinition = {
  name: "get_schema",
  description:
    "Return the JSON Schema of a command's explicit input (every field required, `null` for none), the Modules of the default Registry with their Capabilities, and the Layouts.",
  input: schemaToolInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  async run(_session, input, context): Promise<Envelope> {
    const { command } = schemaToolInput.parse(input);
    const target = schemaCommands[command];
    const registry = await openDefaultRegistry(context);
    return successEnvelope({
      command,
      inputSchema: explicitJsonSchema(
        toExplicitInput(target.input),
        target.name,
        target.description,
      ),
      modules: await modulesOf(registry),
      layouts: Object.keys(layoutTables),
    });
  },
};
