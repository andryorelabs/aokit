import { z } from "zod";
import { defineCommand, type AnyCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

const schemaInput = z.object({
  command: z
    .string()
    .optional()
    .describe("Command whose input JSON Schema to print; omit for an index of commands")
    .register(aokitMeta, { positional: 0, examples: ["schema"] }),
  output: z
    .boolean()
    .default(false)
    .describe("Also print the command's output schema")
    .register(aokitMeta, { flag: "output", examples: ["--output"] }),
});

const schemaOutput = z.record(z.string(), z.unknown());

function toAnnotatedJsonSchema(
  schema: z.ZodType,
  io: "input" | "output",
  name: string,
  description: string,
): Record<string, unknown> {
  const document = z.toJSONSchema(schema, { io });
  document["x-aokit"] = { name, description };
  if (schema instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(schema.shape)) {
      const meta = aokitMeta.get(field);
      const property = document.properties?.[key];
      if (meta !== undefined && typeof property === "object") {
        property["x-aokit"] = meta;
      }
    }
  }
  return document;
}

function findCommand(commands: readonly AnyCommand[], name: string): AnyCommand {
  const found = commands.find((candidate) => candidate.name === name);
  if (found === undefined) {
    const known = commands.map((candidate) => candidate.name).join(", ");
    throw new AokitError(
      "UNKNOWN_COMMAND",
      `unknown command \`${name}\``,
      `choose one of: ${known}; run \`aokit schema\` for the index`,
    );
  }
  return found;
}

export const schemaCommand = defineCommand({
  name: "schema",
  description: "Print the JSON Schema of a command's input",
  input: schemaInput,
  output: schemaOutput,
  run(context, input) {
    if (input.command === undefined) {
      return {
        commands: context.commands.map((command) => ({
          name: command.name,
          description: command.description,
        })),
      };
    }
    const target = findCommand(context.commands, input.command);
    const result: Record<string, unknown> = {
      command: target.name,
      input: toAnnotatedJsonSchema(target.input, "input", target.name, target.description),
    };
    if (input.output) {
      result.output = toAnnotatedJsonSchema(
        target.output,
        "output",
        target.name,
        target.description,
      );
    }
    return result;
  },
});
