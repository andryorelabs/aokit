import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGit } from "../../src/git/git.ts";
import { abortUpdate, readUpdateMarker, writeFileAtomically } from "../../src/update/state.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aokit-state-errors-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("update marker", () => {
  test("a corrupt marker is an IO_ERROR that names the file", async () => {
    mkdirSync(join(root, ".aokit"));
    writeFileSync(join(root, ".aokit", "update.json"), "{ not json");
    const failure = await readUpdateMarker(root, undefined).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "IO_ERROR" });
    expect(String(failure)).toContain("unreadable");
  });

  test("an absent marker reads as null and aborting reports nothing to undo", async () => {
    expect(await readUpdateMarker(root, undefined)).toBeNull();
    expect(await abortUpdate(root, undefined)).toBeNull();
  });

  test("writeFileAtomically creates the file and its directories", async () => {
    const path = join(root, "deep", "state.json");
    await writeFileAtomically(path, "{}\n");
    expect(await Bun.file(path).text()).toBe("{}\n");
  });
});

describe("openGit", () => {
  test("resolves null outside a git repository", async () => {
    expect(await openGit(root)).toBeNull();
  });

  test("refuses to record or clear a conflict for a path with a newline", async () => {
    const init = Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    expect(init.exitCode).toBe(0);
    const git = await openGit(root);
    if (git === null) throw new Error("expected a git repository");
    const stages = { base: "a".repeat(40), user: "b".repeat(40), next: "c".repeat(40) };
    const writeFailure = await git
      .writeConflictStages("bad\nname", stages)
      .catch((error: unknown) => error);
    const clearFailure = await git
      .clearConflictStages("bad\nname")
      .catch((error: unknown) => error);
    expect(writeFailure).toMatchObject({ code: "INVALID_INPUT" });
    expect(clearFailure).toMatchObject({ code: "INVALID_INPUT" });
  });
});
