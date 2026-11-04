import { expect, test } from "bun:test";
import { z } from "zod";
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { defineCommand } from "../../src/cli/command.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { aokitMeta } from "../../src/cli/meta.ts";

const nestedCommand = defineCommand({
  name: "mcp init",
  description: "Register the server in a client",
  input: z.object({
    client: z
      .string()
      .describe("Client to configure")
      .register(aokitMeta, { flag: "client", examples: ["--client cursor"] }),
  }),
  output: z.object({ client: z.string() }),
  run: (_context, input) => ({ client: input.client }),
});

const silentIo: CliIo = { stdout: () => undefined, stderr: () => undefined, isTTY: false };

async function runAokit(
  argv: string[],
  hidden: boolean = false,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    isTTY: false,
  };
  const exitCode = await runCli({
    argv,
    commands: hidden ? exposedCommands : [...exposedCommands, nestedCommand],
    ...(hidden ? { hiddenCommands: [nestedCommand] } : {}),
    env: {},
    version: "9.9.9",
    io,
  });
  return { exitCode, stdout, stderr };
}

test("a command with a space in its name is mounted as a nested subcommand", async () => {
  const result = await runAokit(["mcp", "init", "--client", "cursor", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { client: "cursor" } });
});

test("`mcp init --help` prints the command's flags", async () => {
  const result = await runAokit(["mcp", "init", "--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("--client");
});

test("aokit schema lists the nested command and prints its input schema", async () => {
  const index = JSON.parse((await runAokit(["schema"])).stdout);
  expect(index.commands.map((command: { name: string }) => command.name)).toContain("mcp init");
  const printed = JSON.parse((await runAokit(["schema", "mcp init"])).stdout);
  expect(printed.command).toBe("mcp init");
  expect(printed.input.properties.client["x-aokit"]).toMatchObject({ flag: "client" });
});

test("a hidden nested command is dispatched by its full name", async () => {
  const result = await runAokit(["mcp", "init", "--client", "vscode", "--json"], true);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).data.client).toBe("vscode");
});

const parentCommand = defineCommand({
  name: "mcp",
  description: "Parent command",
  input: z.object({}),
  output: z.object({ parent: z.boolean() }),
  run: () => ({ parent: true }),
});

test("a command and a nested command under the same first word fail loudly in either order", async () => {
  const failures = await Promise.all(
    [
      [parentCommand, nestedCommand],
      [nestedCommand, parentCommand],
    ].map((commands) =>
      runCli({
        argv: ["mcp", "init", "--help"],
        commands,
        env: {},
        version: "9.9.9",
        io: silentIo,
      }).catch((error: unknown) => error),
    ),
  );
  for (const failure of failures) {
    expect(String(failure)).toMatch(/collides/);
  }
});

test("a hidden nested command wins over a hidden parent with the same first word", async () => {
  const result = await runCli({
    argv: ["mcp", "init", "--client", "cursor", "--json"],
    commands: exposedCommands,
    hiddenCommands: [parentCommand, nestedCommand],
    env: {},
    version: "9.9.9",
    io: silentIo,
  });
  expect(result).toBe(0);
});
