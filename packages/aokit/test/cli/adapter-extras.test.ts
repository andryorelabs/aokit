import { expect, spyOn, test } from "bun:test";
import { PassThrough } from "node:stream";
import { z } from "zod";
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { defineCommand } from "../../src/cli/command.ts";
import { parseJson } from "../helpers/cli-json.ts";

const askCommand = defineCommand({
  name: "ask",
  description: "Asks one question on the terminal",
  input: z.object({}),
  output: z.object({ answer: z.string() }),
  run: async (context) => ({ answer: (await context.prompt?.("Name? ")) ?? "" }),
});

const plainCommand = defineCommand({
  name: "plain",
  description: "Echoes a field that carries no aokit meta",
  input: z.object({ name: z.string().default("nobody") }),
  output: z.object({ name: z.string() }),
  run: (_context, input) => ({ name: input.name }),
});

const scalarCommand = defineCommand({
  name: "scalar",
  description: "Takes a bare value instead of an object",
  input: z.string().default("none"),
  output: z.object({ value: z.string() }),
  run: (_context, input) => ({ value: input }),
});

async function runAokit(argv: string[], extra: { interactive?: boolean } = {}) {
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
    commands: [askCommand, plainCommand, scalarCommand],
    env: {},
    version: "9.9.9",
    io,
    ...extra,
  });
  return { exitCode, stdout, stderr };
}

test("the default prompt reads one answer from stdin and prints the question on stderr", async () => {
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  const stdin = new PassThrough();
  const stderrWrite = spyOn(process.stderr, "write").mockImplementation(() => true);
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  try {
    stdin.write("Ada\n");
    const run = await runAokit(["ask", "--json"], { interactive: true });
    expect(run.exitCode).toBe(0);
    expect(parseJson(run.stdout)).toMatchObject({ ok: true, data: { answer: "Ada" } });
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining("Name? "));
  } finally {
    stderrWrite.mockRestore();
    if (original !== undefined) Object.defineProperty(process, "stdin", original);
  }
});

test("--no-color is accepted as a global flag", async () => {
  const run = await runAokit(["plain", "--no-color", "--json"]);
  expect(run.exitCode).toBe(0);
  expect(parseJson(run.stdout)).toMatchObject({ ok: true, data: { name: "nobody" } });
});

test("a field without aokit meta stays a plain option", async () => {
  const run = await runAokit(["plain", "--name", "Ada", "--json"]);
  expect(parseJson(run.stdout)).toMatchObject({ ok: true, data: { name: "Ada" } });
});

test("arguments after -- are passed through untouched", async () => {
  const run = await runAokit(["plain", "--json", "--", "--no-color"]);
  expect(run.stdout.length).toBeGreaterThan(0);
});

test("an unknown command is reported as UNKNOWN_COMMAND", async () => {
  const run = await runAokit(["no-such-command", "--json"]);
  expect(run.exitCode).not.toBe(0);
  expect(parseJson(run.stdout)).toMatchObject({ ok: false, error: { code: "UNKNOWN_COMMAND" } });
});

test("a command whose input is not an object still runs", async () => {
  const run = await runAokit(["scalar", "--json"]);
  expect(parseJson(run.stdout)).toMatchObject({ ok: true, data: { value: "none" } });
});
