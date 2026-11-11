import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { checkTarget } from "../../src/create/target.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aokit-target-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("checkTarget accepts a missing and an empty directory", async () => {
  await checkTarget(join(root, "missing"));
  mkdirSync(join(root, "empty"));
  await checkTarget(join(root, "empty"));
});

test("checkTarget rejects a file with INVALID_INPUT", async () => {
  const file = join(root, "file");
  writeFileSync(file, "x");
  const failure = await checkTarget(file).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AokitError);
  expect(String(failure)).toContain("not a directory");
});

test("checkTarget rejects a non-empty directory with a suggestion", async () => {
  mkdirSync(join(root, "full"));
  writeFileSync(join(root, "full", "a"), "x");
  const failure = await checkTarget(join(root, "full")).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AokitError);
  expect(String(failure)).toContain("not empty");
});

const posixTest = process.platform === "win32" ? test.skip : test;

posixTest("checkTarget rethrows errors other than a missing path", async () => {
  const file = join(root, "file");
  writeFileSync(file, "x");
  const failure = await checkTarget(join(file, "child")).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
});
