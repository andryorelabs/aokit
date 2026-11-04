import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import { InvalidClientConfigError, initMcpClient, mcpClients } from "../../mcp/init/index.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

const mcpInitInput = z.object({
  client: z
    .enum(mcpClients)
    .describe("MCP client to register the server in")
    .register(aokitMeta, { flag: "client", examples: ["--client cursor"] }),
  directory: z
    .string()
    .default(".")
    .describe("Project directory that holds the client config")
    .register(aokitMeta, { flag: "directory", examples: ["--directory ./my-app"] }),
  print: z
    .boolean()
    .default(false)
    .describe("Print the setup instructions instead of writing (claude)")
    .register(aokitMeta, { flag: "print", examples: ["--print"] }),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Print the change and write nothing")
    .register(aokitMeta, { flag: "dry-run", examples: ["--dry-run"] }),
});

const mcpInitOutput = z.object({
  client: z.string(),
  path: z.string().nullable(),
  changed: z.boolean(),
  content: z.string(),
});

export const mcpInitCommand = defineCommand({
  name: "mcp init",
  description: "Register the aokit MCP server (`bunx aokit mcp`) in a client config",
  input: mcpInitInput,
  output: mcpInitOutput,
  async run(_context, input) {
    try {
      return await initMcpClient({ ...input, directory: resolvePath(input.directory) });
    } catch (thrown) {
      if (thrown instanceof InvalidClientConfigError) {
        throw new AokitError(
          "INVALID_CONFIG",
          thrown.message,
          `fix the syntax of \`${thrown.path}\` and run \`aokit mcp init\` again; the file was left unchanged`,
        );
      }
      throw thrown;
    }
  },
});
