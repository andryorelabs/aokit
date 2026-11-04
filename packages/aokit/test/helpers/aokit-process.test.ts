import { afterEach, expect, test } from "bun:test";
import { aokitCommand, spawnAokit } from "./aokit-process.ts";

const originalBinary = process.env["AOKIT_BIN"];

afterEach(() => {
  if (originalBinary === undefined) delete process.env["AOKIT_BIN"];
  else process.env["AOKIT_BIN"] = originalBinary;
});

test("aokitCommand returns the binary path when AOKIT_BIN is set", () => {
  process.env["AOKIT_BIN"] = "/opt/aokit/aokit";
  expect(aokitCommand()).toEqual(["/opt/aokit/aokit"]);
});

test("aokitCommand runs the source entry through Bun when AOKIT_BIN is unset", () => {
  delete process.env["AOKIT_BIN"];
  const command = aokitCommand();
  expect(command[0]).toBe(process.execPath);
  expect(command[1]).toMatch(/src\/cli\/main\.ts$/);
});

test("spawnAokit captures output and exit code", async () => {
  delete process.env["AOKIT_BIN"];
  const result = await spawnAokit(["--version"]);
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout).toMatch(/^\S+\n$/);
});
