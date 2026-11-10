import { describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli/adapter.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";

async function help(argv: string[]): Promise<string> {
  let stdout = "";
  await runCli({
    argv,
    commands: exposedCommands,
    env: {},
    version: "9.9.9",
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => undefined,
      isTTY: false,
    },
    interactive: false,
    updateNotice: false,
  });
  return stdout;
}

const leaks = [
  "Type: string",
  "Negatable",
  "Min length",
  "[boolean]",
  "(default: [])",
  "[values...",
];

describe("--help", () => {
  test("create help carries no trpc-cli metadata", async () => {
    const text = await help(["create", "--help"]);
    for (const leak of leaks) {
      expect(text).not.toContain(leak);
    }
    expect(text).toContain("--answer <value>");
    expect(text).toContain("Module answer as <module.key=value>; repeatable");
  });

  test("every command lists the global flags and stays clean", async () => {
    const names = ["", ...exposedCommands.map((command) => command.name)];
    const texts = await Promise.all(
      names.map((name) => help([...name.split(" ").filter((word) => word !== ""), "--help"])),
    );
    for (const text of texts) {
      expect(text).toContain("--json");
      expect(text).toContain("--quiet");
      expect(text).toContain("--verbose");
      for (const leak of leaks) {
        expect(text).not.toContain(leak);
      }
    }
  });

  test("top-level help does not repeat the subcommand list", async () => {
    const text = await help(["--help"]);
    expect(text).not.toContain("Available subcommands");
    expect(await help(["layout", "--help"])).toContain("migrate");
    expect(await help(["mcp", "--help"])).toContain("init");
  });

  test("a real default is kept", async () => {
    expect(await help(["doctor", "--help"])).not.toContain("(default: [])");
    expect(await help(["create", "--help"])).toContain("(default: true)");
  });

  test("--quiet is accepted and silences a successful run", async () => {
    expect(await help(["--quiet", "schema", "check"])).toBe("");
  });
});

async function failureOutput(argv: string[]): Promise<string> {
  let output = "";
  await runCli({
    argv,
    commands: exposedCommands,
    env: {},
    version: "9.9.9",
    io: {
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        output += text;
      },
      isTTY: false,
    },
    interactive: false,
    updateNotice: false,
  });
  return output;
}

describe("failure diagnostics", () => {
  test("hide raw diagnostic data unless --verbose is set", async () => {
    const quiet = await failureOutput(["create", "x", "--modules", "nextjs", "--yes", "--dry-run"]);
    expect(quiet).toContain("did you mean");
    expect(quiet).not.toContain("resolverCode");
    const verbose = await failureOutput([
      "create",
      "x",
      "--modules",
      "nextjs",
      "--yes",
      "--dry-run",
      "--verbose",
    ]);
    expect(verbose).toContain("resolverCode");
  });

  test("hide raw Registry error data without --verbose", async () => {
    const quiet = await failureOutput([
      "create",
      "x",
      "--modules",
      "hono",
      "--registry",
      "nope",
      "--yes",
      "--dry-run",
    ]);
    expect(quiet).not.toContain("registryCode");
  });
});

describe("positional argument help", () => {
  test("drops trpc-cli type words and stray separators", async () => {
    const text = await help(["add", "--help"]);
    expect(text).not.toMatch(/\barray\b/);
    expect(text).not.toContain("; (");
  });
});
