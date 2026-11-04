import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { runCommand, type CommandContext } from "../../src/cli/command.ts";
import { exposedCommands, hiddenCommands } from "../../src/cli/commands/registry.ts";
import { schemaCommand } from "../../src/cli/commands/schema.ts";
import { stringifySorted } from "../../src/cli/envelope.ts";

interface CapturedRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runAokit(
  argv: string[],
  env: Record<string, string | undefined> = {},
): Promise<CapturedRun> {
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
    hiddenCommands,
    env,
    version: "9.9.9",
    io,
  });
  return { exitCode, stdout, stderr };
}

const directContext: CommandContext = { version: "9.9.9", env: {}, commands: exposedCommands };

describe("aokit --version", () => {
  test("prints only the version", async () => {
    expect(await runAokit(["--version"])).toEqual({ exitCode: 0, stdout: "9.9.9\n", stderr: "" });
  });

  test("with --json wraps the version in the envelope", async () => {
    const result = await runAokit(["--version", "--json"]);
    expect(JSON.parse(result.stdout)).toEqual({
      ok: true,
      data: { version: "9.9.9", lockfileVersion: 2, registryProtocolVersion: 1 },
      error: null,
    });
  });
});

async function runOnTerminal(argv: string[], cacheHome: string): Promise<CapturedRun> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv,
    commands: exposedCommands,
    hiddenCommands,
    env: { XDG_CACHE_HOME: cacheHome },
    version: "9.9.9",
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      isTTY: true,
    },
    interactive: true,
    now: () => 1_800_000_000_000,
    fetch: () => Promise.reject(new Error("offline")),
  });
  return { exitCode, stdout, stderr };
}

describe("aokit update notice", () => {
  test("prints a cached newer version after the output and keeps the exit code", async () => {
    const cacheHome = mkdtempSync(join(tmpdir(), "aokit-notice-"));
    try {
      mkdirSync(join(cacheHome, "aokit"));
      writeFileSync(
        join(cacheHome, "aokit", "update-check.json"),
        JSON.stringify({ latest: "10.0.0", checkedAt: 1_800_000_000_000 }),
      );
      const plain = await runOnTerminal(["--version"], cacheHome);
      expect(plain.stdout).toBe("9.9.9\n");
      expect(plain.exitCode).toBe(0);
      expect(plain.stderr).toContain("9.9.9");
      expect(plain.stderr).toContain("10.0.0");
      const json = await runOnTerminal(["--version", "--json"], cacheHome);
      expect(json.stderr).toBe("");
    } finally {
      rmSync(cacheHome, { recursive: true, force: true });
    }
  });
});

describe("aokit schema", () => {
  test("without an argument prints an index of commands", async () => {
    const result = await runAokit(["schema"]);
    expect(result.exitCode).toBe(0);
    const index = JSON.parse(result.stdout);
    expect(index.commands.map((command: { name: string }) => command.name)).toContain("schema");
  });

  test("prints the input JSON Schema of a command with x-aokit meta", async () => {
    const result = await runAokit(["schema", "schema"]);
    expect(result.exitCode).toBe(0);
    const printed = JSON.parse(result.stdout);
    expect(printed.input.properties.command["x-aokit"]).toEqual({
      examples: ["schema"],
      positional: 0,
    });
    expect(printed.input.properties.output.type).toBe("boolean");
  });

  test("--output also prints the output schema", async () => {
    const result = await runAokit(["schema", "schema", "--output"]);
    expect(JSON.parse(result.stdout)).toHaveProperty("output");
  });

  test("an unknown command name is a usage error", async () => {
    const result = await runAokit(["schema", "nope", "--json"]);
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stdout).error.code).toBe("UNKNOWN_COMMAND");
  });
});

describe("--json", () => {
  test("prints exactly one sorted envelope with no ANSI and nothing on stderr", async () => {
    const result = await runAokit(["schema", "schema", "--json"], { FORCE_COLOR: "1" });
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(result.stdout).not.toContain("\u001B");
    const envelope: unknown = JSON.parse(result.stdout);
    expect(result.stdout.trimEnd()).toBe(stringifySorted(envelope));
  });

  test("errors go to stderr without --json and into the envelope with it", async () => {
    const human = await runAokit(["schema", "nope"]);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("unknown command");
    const machine = await runAokit(["schema", "nope", "--json"]);
    expect(machine.stderr).toBe("");
    expect(JSON.parse(machine.stdout)).toMatchObject({ ok: false, data: null });
  });
});

describe("exit codes", () => {
  test("an unknown flag exits 3", async () => {
    const result = await runAokit(["schema", "--bogus"]);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("--bogus");
  });

  test("an unknown top-level command exits 3", async () => {
    expect((await runAokit(["nope"])).exitCode).toBe(3);
  });

  test("help exits 0", async () => {
    const result = await runAokit(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("schema");
    expect(result.stdout).not.toContain("ExitRequested");
    expect(result.stderr).not.toContain("ExitRequested");
  });
});

describe("adapter parity with direct run", () => {
  test("the same command gives the same data", async () => {
    const viaAdapter = await runAokit(["schema", "schema", "--json"]);
    const viaRun = await runCommand(schemaCommand, directContext, { command: "schema" });
    expect(JSON.parse(viaAdapter.stdout)).toEqual(JSON.parse(stringifySorted(viaRun)));
  });

  test("the same failure gives the same error", async () => {
    const viaAdapter = await runAokit(["schema", "nope", "--json"]);
    const viaRun = await runCommand(schemaCommand, directContext, { command: "nope" });
    expect(JSON.parse(viaAdapter.stdout)).toEqual(JSON.parse(stringifySorted(viaRun)));
  });

  test("invalid direct input is an INVALID_INPUT envelope", async () => {
    const result = await runCommand(schemaCommand, directContext, { command: 42 });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
});

describe("lifecycle commands", () => {
  test("recopy is dispatched and listed in aokit schema", async () => {
    const schema = await runAokit(["schema", "--json"]);
    expect(schema.stdout).toContain("recopy");
    const empty = mkdtempSync(join(tmpdir(), "aokit-run-"));
    try {
      const result = await runAokit(["recopy", "--json", "--directory", empty]);
      expect(result.stdout).not.toContain("UNKNOWN_COMMAND");
      expect(result.stdout).toContain("LOCKFILE_MISSING");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
