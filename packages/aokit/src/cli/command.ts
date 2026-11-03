import type { z } from "zod";
import { errorPayloadFrom, failureEnvelope, successEnvelope, type Envelope } from "./envelope.ts";

/** What every command receives besides its input. */
export interface CommandContext {
  version: string;
  env: Readonly<Record<string, string | undefined>>;
  commands: readonly AnyCommand[];
}

export interface Command<Input extends z.ZodType, Output extends z.ZodType> {
  name: string;
  description: string;
  input: Input;
  output: Output;
  run(
    context: CommandContext,
    input: z.output<Input>,
  ): Promise<z.output<Output>> | z.output<Output>;
}

export interface AnyCommand {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
  run(context: CommandContext, input: unknown): unknown;
}

export function defineCommand<Input extends z.ZodType, Output extends z.ZodType>(
  command: Command<Input, Output>,
): Command<Input, Output> {
  return command;
}

/**
 * Validates raw input, runs the command and wraps the outcome in an envelope.
 * The adapter and direct callers (tests, MCP) both go through here, so a
 * command behaves identically on every surface.
 */
export async function runCommand(
  command: AnyCommand,
  context: CommandContext,
  rawInput: unknown,
): Promise<Envelope> {
  const parsedInput = command.input.safeParse(rawInput);
  if (!parsedInput.success) {
    const issues = parsedInput.error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    return failureEnvelope({
      code: "INVALID_INPUT",
      message: `invalid input for \`${command.name}\`: ${issues}`,
      fix: `run \`aokit schema ${command.name}\` to see the accepted input`,
    });
  }
  try {
    const output: unknown = await command.run(context, parsedInput.data);
    return successEnvelope(command.output.parse(output));
  } catch (thrown) {
    return failureEnvelope(errorPayloadFrom(thrown));
  }
}
