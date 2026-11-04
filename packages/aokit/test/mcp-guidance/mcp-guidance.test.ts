import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createCommand } from "../../src/cli/commands/create.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { errorCodeExitCodes } from "../../src/cli/exit-codes.ts";
import { cliOnlyFields } from "../../src/mcp/explicit-input.ts";
import { callTool, connectClient } from "../mcp/helpers.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { runCommand } from "../../src/cli/command.ts";
import { openDefaultRegistry } from "../../src/mcp/tools/schema.ts";
import { guidanceTopics, renderGuidance } from "../../src/mcp/guidance/index.ts";

const topics = ["overview", "workflow", "modules", "layouts", "errors"] as const;

async function markdownOf(topic: string): Promise<string> {
  const client = await connectClient();
  const result = await callTool(client, "get_guidance", { topic });
  expect(result.ok).toBe(true);
  expect(result.isError).toBe(false);
  expect(result.data?.["topic"]).toBe(topic);
  return z.string().parse(result.data?.["markdown"]);
}

describe("get_guidance", () => {
  test("is listed as read-only with a required topic", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === "get_guidance");
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.inputSchema.required).toEqual(["topic"]);
  });

  test.each(topics)("the %s topic is non-empty markdown", async (topic) => {
    expect((await markdownOf(topic)).trim()).not.toBe("");
  });

  test("the topic list matches the tool input", () => {
    expect([...guidanceTopics]).toEqual([...topics]);
  });

  test("modules lists every bundled Module in a generated table", async () => {
    const registry = await openDefaultRegistry({ version: cliVersion, env: {}, commands: [] });
    const markdown = await markdownOf("modules");
    for (const name of Object.keys(registry.index.modules)) {
      expect(markdown).toContain(`| \`${name}\` |`);
    }
  });

  test("layouts lists both Layouts in a generated table", async () => {
    const markdown = await markdownOf("layouts");
    expect(markdown).toContain("| `single` |");
    expect(markdown).toContain("| `monorepo` |");
  });

  test("errors lists every code of the exit-code table with its category", async () => {
    const markdown = await markdownOf("errors");
    for (const code of Object.keys(errorCodeExitCodes)) {
      expect(markdown).toContain(`| \`${code}\` |`);
    }
    expect(markdown).toContain("| `PLAN_REQUIRED` | precondition | 5 |");
    expect(markdown).toContain("| `CAPABILITY_CONFLICT` | resolution | 4 |");
  });

  test("a code added to the exit-code table appears without editing markdown", async () => {
    const registry = await openDefaultRegistry({ version: cliVersion, env: {}, commands: [] });
    const table: Record<string, number> = errorCodeExitCodes;
    table["BRAND_NEW_CODE"] = 5;
    try {
      expect(renderGuidance("errors", registry)).toContain(
        "| `BRAND_NEW_CODE` | precondition | 5 |",
      );
    } finally {
      delete table["BRAND_NEW_CODE"];
    }
  });

  test("an unknown topic is an INVALID_INPUT result", async () => {
    const client = await connectClient();
    const result = await callTool(client, "get_guidance", { topic: "nope" });
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});

const schemaResult = z.object({
  command: z.string(),
  inputSchema: z.object({
    required: z.array(z.string()),
    properties: z.record(z.string(), z.record(z.string(), z.unknown())),
    "x-aokit": z.object({ name: z.string(), description: z.string() }),
  }),
  modules: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      provides: z.array(z.string()),
      requires: z.array(z.string()),
      conflicts: z.array(z.string()),
    }),
  ),
  layouts: z.array(z.string()),
});

describe("get_schema", () => {
  test("is listed as read-only", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === "get_schema")?.annotations?.readOnlyHint).toBe(true);
  });

  test("create: every property is required and every bundled Module is listed", async () => {
    const client = await connectClient();
    const result = await callTool(client, "get_schema", { command: "create" });
    expect(result.error).toBeNull();
    const parsed = schemaResult.parse(result.data);
    expect(parsed.command).toBe("create");
    expect(parsed.inputSchema.required.toSorted()).toEqual(
      Object.keys(parsed.inputSchema.properties).toSorted(),
    );
    const registry = await openDefaultRegistry({ version: cliVersion, env: {}, commands: [] });
    expect(parsed.modules.map((module) => module.name)).toEqual(
      Object.keys(registry.index.modules).toSorted(),
    );
    expect(parsed.layouts).toEqual(["single", "monorepo"]);
    const vite = parsed.modules.find((module) => module.name === "vite-react");
    expect(vite?.provides.length).toBeGreaterThan(0);
  });

  test("agrees with `aokit schema` on every property of the create input", async () => {
    const client = await connectClient();
    const result = await callTool(client, "get_schema", { command: "create" });
    const parsed = schemaResult.parse(result.data);
    const cli = await runCommand(
      exposedCommands.find((command) => command.name === "schema") ?? createCommand,
      { version: cliVersion, env: {}, commands: exposedCommands },
      { command: "create" },
    );
    const cliInput = z
      .object({
        input: z.object({
          properties: z.record(z.string(), z.record(z.string(), z.unknown())),
        }),
      })
      .parse(cli.data).input.properties;
    const expectedKeys = Object.keys(cliInput)
      .filter((key) => !(cliOnlyFields as readonly string[]).includes(key))
      .toSorted();
    expect(Object.keys(parsed.inputSchema.properties).toSorted()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(parsed.inputSchema.properties[key]?.["x-aokit"]).toEqual(cliInput[key]?.["x-aokit"]);
      expect(parsed.inputSchema.properties[key]?.["description"]).toEqual(
        cliInput[key]?.["description"],
      );
    }
    expect(parsed.inputSchema["x-aokit"].name).toBe("create");
  });

  test.each(["add", "remove", "update"])("%s returns its explicit input", async (command) => {
    const client = await connectClient();
    const result = await callTool(client, "get_schema", { command });
    expect(result.error).toBeNull();
    const parsed = schemaResult.parse(result.data);
    expect(parsed.command).toBe(command);
    expect(parsed.inputSchema.required.length).toBeGreaterThan(0);
    for (const cliOnly of cliOnlyFields) {
      expect(Object.keys(parsed.inputSchema.properties)).not.toContain(cliOnly);
    }
  });

  test("an unknown command is an INVALID_INPUT result", async () => {
    const client = await connectClient();
    const result = await callTool(client, "get_schema", { command: "doctor" });
    expect(result.error?.code).toBe("INVALID_INPUT");
  });
});
