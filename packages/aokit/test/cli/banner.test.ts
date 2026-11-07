import { expect, test } from "bun:test";
import { join } from "node:path";
import { runCli, type CliIo } from "../../src/cli/adapter.ts";
import { bannerAnsi, bannerPlain, renderBanner } from "../../src/cli/banner.ts";
import { exposedCommands, hiddenCommands } from "../../src/cli/commands/registry.ts";
import { spawnAokit } from "../helpers/aokit-process.ts";

const terminalDirectory = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "docs",
  "brand",
  "terminal",
);

async function runOnStream(
  argv: string[],
  isTTY: boolean,
  env: Record<string, string | undefined> = {},
): Promise<string> {
  let stdout = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: () => {},
    isTTY,
  };
  await runCli({
    argv,
    commands: exposedCommands,
    hiddenCommands,
    env,
    version: "9.9.9",
    io,
    updateNotice: false,
  });
  return stdout;
}

test("the CLI constants are byte-identical to the committed brand files", async () => {
  expect(bannerAnsi).toBe(await Bun.file(join(terminalDirectory, "banner.ansi")).text());
  expect(bannerPlain).toBe(await Bun.file(join(terminalDirectory, "banner.txt")).text());
});

test("renderBanner picks the variant by color", () => {
  expect(renderBanner({ color: true })).toBe(bannerAnsi);
  expect(renderBanner({ color: false })).toBe(bannerPlain);
});

test("root no-args, --help and -h print the banner on a terminal", async () => {
  const outputs = await Promise.all(
    [[], ["--help"], ["-h"]].map((argv) => runOnStream(argv, true)),
  );
  for (const stdout of outputs) {
    expect(stdout.startsWith(bannerAnsi)).toBe(true);
  }
});

test("NO_COLOR prints the plain banner", async () => {
  const stdout = await runOnStream([], true, { NO_COLOR: "1" });
  expect(stdout.startsWith(bannerPlain)).toBe(true);
  expect(stdout).not.toContain("\u001B");
});

test("no banner when stdout is not a terminal, with --json, subcommand help or --version", async () => {
  expect(await runOnStream([], false)).not.toContain("██");
  expect(await runOnStream([], false, { FORCE_COLOR: "1" })).not.toContain("██");
  expect(await runOnStream(["--help", "--json"], true)).not.toContain("██");
  expect(await runOnStream(["schema", "--help"], true)).not.toContain("██");
  expect(await runOnStream(["--version"], true)).toBe("9.9.9\n");
});

test("a piped aokit --help has no banner through the binary entry", async () => {
  const result = await spawnAokit(["--help"], { env: { NO_COLOR: "", FORCE_COLOR: "" } });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("██");
});
