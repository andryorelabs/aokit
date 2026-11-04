import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { CommandContext } from "../cli/command.ts";
import { exposedCommands } from "../cli/commands/registry.ts";
import {
  errorDataFrom,
  errorPayloadFrom,
  failureEnvelope,
  type Envelope,
} from "../cli/envelope.ts";
import { cliVersion } from "../cli/version.ts";
import { z } from "zod";
import { createPlanSession } from "./plan-id.ts";
import { toToolResult } from "./result.ts";
import { mcpTools } from "./tools/index.ts";

/** Runs tool calls one at a time, so two writes into one directory never interleave. */
function createCallQueue(): {
  run(task: () => Promise<Envelope>): Promise<Envelope>;
  idle(): Promise<void>;
} {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(task) {
      const next = tail.then(task, task);
      tail = next.catch(() => undefined);
      return next;
    },
    async idle() {
      await tail;
    },
  };
}

/**
 * Wraps a tool input so the SDK advertises the real JSON Schema but never rejects a call itself;
 * validation happens in the handler, where a failure becomes an `INVALID_INPUT` envelope.
 */
function passThroughSchema(input: z.ZodObject): StandardSchemaWithJSON {
  const advertised = input["~standard"];
  return {
    "~standard": {
      version: 1,
      vendor: "aokit",
      validate: (value: unknown) => ({ value }),
      jsonSchema: advertised.jsonSchema,
    },
  };
}

function invalidToolInput(toolName: string, error: z.ZodError): Envelope {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  return failureEnvelope({
    code: "INVALID_INPUT",
    message: `invalid input for \`${toolName}\`: ${issues}`,
    fix: `pass every field of the \`${toolName}\` input; use \`null\` for a field you do not set`,
  });
}

const idleByServer = new WeakMap<McpServer, () => Promise<void>>();

/**
 * Builds the aokit MCP server with every tool of {@link mcpTools} registered. Each server has its
 * own Plan session, and commands always run with `interactive: false`.
 */
export function createMcpServer(options: { context: CommandContext }): McpServer {
  const context: CommandContext = { ...options.context, interactive: false };
  const session = createPlanSession();
  const queue = createCallQueue();
  const server = new McpServer({ name: "aokit", version: context.version });
  for (const tool of mcpTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: passThroughSchema(tool.input),
        annotations: tool.annotations,
      },
      async (input: unknown) => {
        const envelope = await queue.run(async () => {
          const parsed = tool.input.safeParse(input ?? {});
          if (!parsed.success) return invalidToolInput(tool.name, parsed.error);
          try {
            return await tool.run(session, parsed.data, context);
          } catch (thrown) {
            return failureEnvelope(errorPayloadFrom(thrown), errorDataFrom(thrown));
          }
        });
        return toToolResult(envelope);
      },
    );
  }
  idleByServer.set(server, () => queue.idle());
  return server;
}

/**
 * Serves {@link createMcpServer} over stdio. stdout carries only protocol frames; when stdin
 * closes, the running call finishes and the process exits with 0.
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer({
    context: {
      version: cliVersion,
      env: process.env,
      commands: exposedCommands,
      interactive: false,
    },
  });
  const closed = Promise.withResolvers<void>();
  process.stdin.once("end", closed.resolve);
  process.stdin.once("close", closed.resolve);
  await server.connect(new StdioServerTransport());
  await closed.promise;
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  await idleByServer.get(server)?.();
  await server.close();
  process.exitCode = 0;
}
