import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abortUpdate, readUpdateMarker } from "../../src/update/state.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aokit-state-io-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeMarker(stashDirectory: string): void {
  mkdirSync(join(root, ".aokit"), { recursive: true });
  writeFileSync(
    join(root, ".aokit", "update.json"),
    JSON.stringify({
      stashDirectory,
      conflictedPaths: [],
      newSiblingPaths: [],
      previousLockfile: "{}",
    }),
  );
}

describe("update state I/O failures", () => {
  test("a marker path that cannot be read as a file keeps its own error", async () => {
    mkdirSync(join(root, ".aokit", "update.json"), { recursive: true });
    const failure = await readUpdateMarker(root, undefined).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "EISDIR" });
  });

  test("a saved Plan path that cannot be read as a file fails the abort", async () => {
    mkdirSync(join(root, ".aokit", "plan.json"), { recursive: true });
    const failure = await abortUpdate(root, undefined).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "EISDIR" });
  });

  test("a state directory that cannot be removed fails the abort", async () => {
    const target = join(root, "elsewhere");
    mkdirSync(target);
    symlinkSync(target, join(root, ".aokit"));
    const failure = await abortUpdate(root, undefined).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "ENOTDIR" });
  });

  test("a missing stash is an IO_ERROR that names it", async () => {
    const stash = join(root, "gone");
    writeMarker(stash);
    const failure = await abortUpdate(root, undefined).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "IO_ERROR" });
    expect(String(failure)).toContain(`The stash ${stash} of the update in progress is missing.`);
  });

  test("a stash that cannot be listed keeps its own error", async () => {
    const stash = join(root, "stash-file");
    writeFileSync(stash, "x");
    writeMarker(stash);
    const failure = await abortUpdate(root, undefined).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "ENOTDIR" });
  });
});
