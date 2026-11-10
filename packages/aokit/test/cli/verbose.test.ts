import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { runCli } from "../../src/cli/adapter.ts";
import { defineCommand } from "../../src/cli/command.ts";

interface CapturedRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const crashingCommand = defineCommand({
  name: "crash",
  description: "Always throws an unexpected error.",
  input: z.object({}),
  output: z.unknown(),
  run: () => {
    throw new Error("kaboom");
  },
});

async function runCrash(argv: string[]): Promise<CapturedRun> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv,
    commands: [crashingCommand],
    env: {},
    version: "9.9.9",
    io: {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      isTTY: false,
    },
    updateNotice: false,
  });
  return { exitCode, stdout, stderr };
}

describe("aokit --verbose", () => {
  test("prints the stack to stderr and leaves the --json envelope byte-identical", async () => {
    const quiet = await runCrash(["crash", "--json"]);
    const verbose = await runCrash(["crash", "--json", "--verbose"]);
    expect(verbose.stdout).toBe(quiet.stdout);
    expect(verbose.exitCode).toBe(quiet.exitCode);
    expect(quiet.stderr).toBe("");
    expect(verbose.stderr).toContain("Error: kaboom");
    expect(verbose.stderr).toContain("verbose.test.ts");
    expect(verbose.stdout).not.toContain("verbose.test.ts");
  });

  test("prints the stack in human mode only with --verbose", async () => {
    const quiet = await runCrash(["crash"]);
    const verbose = await runCrash(["crash", "--verbose"]);
    expect(quiet.stderr).not.toContain("verbose.test.ts");
    expect(verbose.stderr).toContain("verbose.test.ts");
    expect(verbose.stderr).toContain("error: kaboom");
    expect(verbose.stdout).toBe(quiet.stdout);
  });
});
