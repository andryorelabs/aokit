import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("S8: the repo-settings:check entry point exits 1 with the reason when gh is not on PATH", () => {
  const emptyPath = mkdtempSync(join(tmpdir(), "repo-settings-no-gh-"));
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "main.ts")], {
    env: { ...process.env, PATH: emptyPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toStartWith(
    "repo-settings:check could not read the live settings: could not run gh.",
  );
});
