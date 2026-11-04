import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { spawnAokit as spawnAokitProcess } from "../helpers/aokit-process.ts";

const shutdownModule = join(import.meta.dir, "..", "..", "src", "cli", "shutdown.ts");

function spawnAokit(argv: string[], env: Record<string, string> = {}) {
  return spawnAokitProcess(argv, { env: { NO_COLOR: "", FORCE_COLOR: "", ...env } });
}

test("aokit --version prints only the version through the binary entry", async () => {
  const result = await spawnAokit(["--version"]);
  const packageManifest: { version: string } = await Bun.file(
    join(import.meta.dir, "..", "..", "package.json"),
  ).json();
  expect(result).toEqual({ stdout: `${packageManifest.version}\n`, stderr: "", exitCode: 0 });
});

test("aokit schema schema --json prints one envelope through the binary entry", async () => {
  const result = await spawnAokit(["schema", "schema", "--json"], { FORCE_COLOR: "1" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).not.toContain("\u001B");
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, error: null });
});

test("an unknown flag exits 3 through the binary entry", async () => {
  const result = await spawnAokit(["schema", "--bogus"]);
  expect(result.exitCode).toBe(3);
  expect(result.stdout).toBe("");
});

test("NO_COLOR keeps error output free of ANSI even when a TTY is forced", async () => {
  const result = await spawnAokit(["schema", "nope"], { NO_COLOR: "1", FORCE_COLOR: "1" });
  expect(result.stderr).not.toContain("\u001B");
});

test("SIGINT runs the registered shutdown hook and exits 130", async () => {
  const workDirectory = mkdtempSync(join(tmpdir(), "aokit-sigint-"));
  const markerPath = join(workDirectory, "marker");
  try {
    const interruptibleScript = `
      import { appendFileSync } from "node:fs";
      import { installSignalHandlers, registerShutdownHook } from ${JSON.stringify(shutdownModule)};
      installSignalHandlers();
      registerShutdownHook(() => appendFileSync(${JSON.stringify(markerPath)}, "cleaned\\n"));
      process.stdout.write("ready\\n");
      setInterval(() => {}, 1000);
    `;
    const child = Bun.spawn(["bun", "--eval", interruptibleScript], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    await reader.read();
    child.kill("SIGINT");
    expect(await child.exited).toBe(130);
    expect(readFileSync(markerPath, "utf8")).toBe("cleaned\n");
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
});
