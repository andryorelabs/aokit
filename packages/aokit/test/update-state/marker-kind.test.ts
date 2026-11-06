import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AokitError } from "../../src/cli/envelope.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { abortLifecycle } from "../../src/lifecycle/run.ts";
import { abortUpdate, readUpdateMarker, writeUpdateMarker } from "../../src/update/state.ts";

let project = "";
const markerFile = () => join(project, ".aokit", "update.json");
const baseMarker = {
  stashDirectory: "/nonexistent/stash",
  conflictedPaths: [],
  newSiblingPaths: [],
  previousLockfile: "{}\n",
};

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "aokit-marker-kind-"));
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

describe("undo marker kind", () => {
  test("a marker without a kind reads as update and is not rewritten", async () => {
    await mkdir(join(project, ".aokit"));
    const legacy = `${JSON.stringify(baseMarker)}\n`;
    await writeFile(markerFile(), legacy);
    expect((await readUpdateMarker(project, undefined))?.kind).toBe("update");
    expect(await readFile(markerFile(), "utf8")).toBe(legacy);
  });

  test("the kind is recorded and read back", async () => {
    await writeUpdateMarker(project, undefined, { ...baseMarker, kind: "layout-migrate" });
    expect((await readUpdateMarker(project, undefined))?.kind).toBe("layout-migrate");
    await writeUpdateMarker(project, undefined, baseMarker);
    expect((await readUpdateMarker(project, undefined))?.kind).toBe("update");
  });

  test("update abort refuses a layout-migrate marker and touches nothing", async () => {
    await writeUpdateMarker(project, undefined, { ...baseMarker, kind: "layout-migrate" });
    const before = await readFile(markerFile(), "utf8");
    const thrown = await abortLifecycle(project, "update").then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(AokitError);
    if (!(thrown instanceof AokitError)) throw new Error("unreachable");
    expect(thrown.code).toBe("INVALID_INPUT");
    expect(exitCodeForErrorCode(thrown.code)).toBe(3);
    expect(`${thrown.message} ${thrown.fix}`).toContain("aokit layout migrate --abort");
    expect(await readFile(markerFile(), "utf8")).toBe(before);
    expect((await stat(project)).isDirectory()).toBe(true);
  });

  test("layout-migrate abort refuses an update marker", async () => {
    await writeUpdateMarker(project, undefined, baseMarker);
    const thrown = await abortUpdate(project, undefined, "layout-migrate").then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(AokitError);
    expect(thrown instanceof AokitError && thrown.fix).toContain("aokit update --abort");
  });
});
