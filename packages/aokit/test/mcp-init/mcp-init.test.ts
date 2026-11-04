import { z } from "zod";
import { parse } from "jsonc-parser";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { runCommand } from "../../src/cli/command.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { mcpInitCommand } from "../../src/cli/commands/mcp-init.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "aokit-mcp-init-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const context = { version: "9.9.9", env: {}, commands: exposedCommands };

async function init(input: Record<string, unknown>) {
  return runCommand(mcpInitCommand, context, { directory, ...input });
}

async function runAokit(argv: string[]) {
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
    commands: exposedCommands,
    env: {},
    version: "9.9.9",
    io,
  });
  return { exitCode, stdout, stderr };
}

function contentOf(result: { data: unknown }): string {
  return z.object({ content: z.string() }).parse(result.data).content;
}

const read = (path: string) => readFile(join(directory, path), "utf8");

test("claude writes .mcp.json with mcpServers", async () => {
  const result = await init({ client: "claude" });
  expect(result).toMatchObject({
    ok: true,
    data: { client: "claude", path: ".mcp.json", changed: true },
  });
  expect(JSON.parse(await read(".mcp.json"))).toEqual({
    mcpServers: { aokit: { command: "bunx", args: ["aokit", "mcp"] } },
  });
});

test("claude --print prints claude mcp add and writes nothing", async () => {
  const result = await init({ client: "claude", print: true });
  expect(result).toMatchObject({ ok: true, data: { path: null, changed: false } });
  expect(contentOf(result)).toContain("claude mcp add aokit -- bunx aokit mcp");
  expect(await Bun.file(join(directory, ".mcp.json")).exists()).toBe(false);
});

test("cursor writes .cursor/mcp.json with mcpServers", async () => {
  await init({ client: "cursor" });
  expect(JSON.parse(await read(".cursor/mcp.json"))).toEqual({
    mcpServers: { aokit: { command: "bunx", args: ["aokit", "mcp"] } },
  });
});

test("vscode writes .vscode/mcp.json with servers and type stdio", async () => {
  await init({ client: "vscode" });
  expect(JSON.parse(await read(".vscode/mcp.json"))).toEqual({
    servers: { aokit: { type: "stdio", command: "bunx", args: ["aokit", "mcp"] } },
  });
});

test("codex prints the TOML block and writes nothing", async () => {
  const result = await init({ client: "codex" });
  expect(result).toMatchObject({ ok: true, data: { client: "codex", path: null, changed: false } });
  const content = contentOf(result);
  expect(content).toContain("[mcp_servers.aokit]");
  expect(content).toContain('command = "bunx"');
  expect(content).toContain('args = ["aokit", "mcp"]');
});

test.each(["claude", "cursor", "vscode"])("a second %s run is a no-op", async (client) => {
  await init({ client });
  const result = await init({ client });
  expect(result).toMatchObject({ ok: true, data: { changed: false } });
});

test("--dry-run reports the change and writes nothing", async () => {
  const result = await init({ client: "cursor", dryRun: true });
  expect(result).toMatchObject({ ok: true, data: { changed: true, path: ".cursor/mcp.json" } });
  expect(contentOf(result)).toContain('"aokit"');
  expect(await Bun.file(join(directory, ".cursor/mcp.json")).exists()).toBe(false);
});

test("another server stays byte-identical", async () => {
  await mkdir(join(directory, ".cursor"));
  const other = `{\n  "mcpServers": {\n    "zeta": { "command": "node", "args": ["z.js"] }\n  }\n}\n`;
  await writeFile(join(directory, ".cursor/mcp.json"), other);
  await init({ client: "cursor" });
  const text = await read(".cursor/mcp.json");
  const parsed = JSON.parse(text);
  expect(Object.keys(parsed.mcpServers).toSorted()).toEqual(["aokit", "zeta"]);
  expect(text).toContain(`    "zeta": { "command": "node", "args": ["z.js"] }`);
});

test("comments and trailing commas survive", async () => {
  const original = `{\n  // keep me\n  "mcpServers": {\n    "zeta": { "command": "node", }, // trailing\n  },\n}\n`;
  await writeFile(join(directory, ".mcp.json"), original);
  await init({ client: "claude" });
  const text = await read(".mcp.json");
  expect(text).toContain("// keep me");
  expect(text).toContain(`"zeta": { "command": "node", }, // trailing`);
  expect(text).toContain('"aokit"');
});

test("an existing aokit entry with different args is replaced, not unioned", async () => {
  await writeFile(
    join(directory, ".mcp.json"),
    `{\n  // note\n  "mcpServers": {\n    "aokit": { "command": "npx", "args": ["old"] }\n  }\n}\n`,
  );
  const result = await init({ client: "claude" });
  expect(result).toMatchObject({ ok: true, data: { changed: true } });
  const text = await read(".mcp.json");
  expect(text).toContain("// note");
  expect(parse(text).mcpServers.aokit).toEqual({ command: "bunx", args: ["aokit", "mcp"] });
});

test("an existing aokit entry keeps keys the user added", async () => {
  await writeFile(
    join(directory, ".mcp.json"),
    `{\n  // note\n  "mcpServers": {\n    "aokit": { "command": "npx", "args": ["old"], "env": { "A": "1" } }\n  }\n}\n`,
  );
  const result = await init({ client: "claude" });
  expect(result).toMatchObject({ ok: true, data: { changed: true } });
  const text = await read(".mcp.json");
  expect(text).toContain("// note");
  expect(parse(text).mcpServers.aokit).toEqual({
    command: "bunx",
    args: ["aokit", "mcp"],
    env: { A: "1" },
  });
  expect(await init({ client: "claude" })).toMatchObject({ ok: true, data: { changed: false } });
});

test("an invalid JSONC file fails with INVALID_CONFIG and stays unchanged", async () => {
  const broken = `{ "mcpServers": { `;
  await writeFile(join(directory, ".mcp.json"), broken);
  const result = await init({ client: "claude" });
  expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CONFIG" } });
  expect(await read(".mcp.json")).toBe(broken);
  expect(exitCodeForErrorCode("INVALID_CONFIG")).toBe(3);
});

test("a non-object root fails with INVALID_CONFIG", async () => {
  await writeFile(join(directory, ".mcp.json"), "[]");
  const result = await init({ client: "claude" });
  expect(result).toMatchObject({ ok: false, error: { code: "INVALID_CONFIG" } });
  expect(await read(".mcp.json")).toBe("[]");
});

test("--json returns client, path, changed and content", async () => {
  const run = await runAokit([
    "mcp",
    "init",
    "--client",
    "vscode",
    "--directory",
    directory,
    "--json",
  ]);
  expect(run.exitCode).toBe(0);
  const envelope = JSON.parse(run.stdout);
  expect(Object.keys(envelope.data).toSorted()).toEqual(["changed", "client", "content", "path"]);
});

test("aokit schema lists mcp init and --help prints its flags", async () => {
  const index = JSON.parse((await runAokit(["schema"])).stdout);
  expect(index.commands.map((command: { name: string }) => command.name)).toContain("mcp init");
  const help = await runAokit(["mcp", "init", "--help"]);
  expect(help.exitCode).toBe(0);
  for (const flag of ["--client", "--print", "--dry-run"]) expect(help.stdout).toContain(flag);
});
