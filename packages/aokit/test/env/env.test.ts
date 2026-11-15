import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { join, relative } from "node:path";
import {
  ENVIRONMENT_VARIABLE_NAMES,
  clearNativeLibraryPath,
  processEnvironment,
  readFirstNonEmptyVariable,
  readForceColor,
  readIsAgentRun,
  readIsContinuousIntegration,
  readIsDumbTerminal,
  readNoColor,
  readNonEmptyVariable,
  readUpdateNotifierDisabled,
  readVariable,
  setNativeLibraryPath,
} from "../../src/env.ts";

const sourceRoot = join(import.meta.dir, "..", "..", "src");
const environmentModule = "env.ts";
const environmentReader = /\b(?:process|Bun)\.env\b/;

/**
 * Readers not yet migrated to `src/env.ts`; each is owned by a later ticket and must be removed
 * from this list when it migrates. A new file never belongs here.
 */
const pendingMigration: ReadonlySet<string> = new Set([
  "cli/run.ts",
  "cli/update-notice/spawn.ts",
  "config/user-config.ts",
  "git/run.ts",
  "lifecycle/run.ts",
  "mcp/server.ts",
  "project/registry/context.ts",
  "project/registry/open-source.ts",
  "registry/bundled.ts",
  "registry/cache.ts",
  "registry/client/index-file.ts",
  "registry/client/shadcn-items.ts",
  "registry/client/shadcn.ts",
  "update/run.ts",
]);

async function filesReadingTheEnvironment(): Promise<string[]> {
  const offenders: string[] = [];
  for await (const path of new Glob("**/*.ts").scan({ cwd: sourceRoot, absolute: true })) {
    const name = relative(sourceRoot, path).replaceAll("\\", "/");
    if (name === environmentModule) continue;
    const text = await Bun.file(path).text();
    const readsCode = text
      .split("\n")
      .some((line) => !/^\s*(?:\/\/|\/?\*)/.test(line) && environmentReader.test(line));
    if (readsCode) offenders.push(name);
  }
  return offenders.toSorted();
}

describe("environment module", () => {
  test("no source file outside src/env.ts reads the process environment", async () => {
    const offenders = (await filesReadingTheEnvironment()).filter(
      (name) => !pendingMigration.has(name),
    );
    expect(
      offenders,
      `read process.env or Bun.env outside src/env.ts: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  test("the pending list holds only files that still read the environment", async () => {
    const offenders = new Set(await filesReadingTheEnvironment());
    const stale = [...pendingMigration].filter((name) => !offenders.has(name));
    expect(stale, `migrated files still listed as pending: ${stale.join(", ")}`).toEqual([]);
  });

  test("the names list has no duplicates", () => {
    expect(new Set(ENVIRONMENT_VARIABLE_NAMES).size).toBe(ENVIRONMENT_VARIABLE_NAMES.length);
  });
});

describe("environment readers", () => {
  test("readVariable returns the raw value and readNonEmptyVariable drops empty ones", () => {
    expect(readVariable({ HOME: "" }, "HOME")).toBe("");
    expect(readNonEmptyVariable({ HOME: "" }, "HOME")).toBeUndefined();
    expect(readNonEmptyVariable({ HOME: "/h" }, "HOME")).toBe("/h");
    expect(readNonEmptyVariable({}, "HOME")).toBeUndefined();
  });

  test("readFirstNonEmptyVariable skips unset and empty values", () => {
    expect(
      readFirstNonEmptyVariable({ USERPROFILE: "", HOME: "/h" }, ["USERPROFILE", "HOME"]),
    ).toBe("/h");
    expect(readFirstNonEmptyVariable({}, ["USERPROFILE", "HOME"])).toBeUndefined();
  });

  test("colour readers", () => {
    expect(readNoColor({ NO_COLOR: "1" })).toBe(true);
    expect(readNoColor({ NO_COLOR: "" })).toBe(false);
    expect(readForceColor({ FORCE_COLOR: "1" })).toBe(true);
    expect(readForceColor({ FORCE_COLOR: "0" })).toBe(false);
    expect(readForceColor({})).toBe(false);
    expect(readIsDumbTerminal({ TERM: "dumb" })).toBe(true);
    expect(readIsDumbTerminal({ TERM: "xterm" })).toBe(false);
  });

  test("update notice readers", () => {
    expect(readUpdateNotifierDisabled({ AOKIT_NO_UPDATE_NOTIFIER: "1" })).toBe(true);
    expect(readUpdateNotifierDisabled({ AOKIT_NO_UPDATE_NOTIFIER: "0" })).toBe(false);
    expect(readIsContinuousIntegration({ CI: "true" })).toBe(true);
    for (const value of [undefined, "", "0", "false"]) {
      expect(readIsContinuousIntegration({ CI: value })).toBe(false);
    }
  });

  test("readIsAgentRun detects any agent variable", () => {
    expect(readIsAgentRun({})).toBe(false);
    expect(readIsAgentRun({ CLAUDECODE: "1" })).toBe(true);
    expect(readIsAgentRun({ AOKIT_AGENT: "" })).toBe(false);
  });

  test("processEnvironment is the live process environment", () => {
    expect(processEnvironment()).toBe(process.env);
  });

  test("the native library path is set and cleared", () => {
    setNativeLibraryPath("/tmp/lib");
    expect(process.env["NAPI_RS_NATIVE_LIBRARY_PATH"]).toBe("/tmp/lib");
    clearNativeLibraryPath();
    expect(process.env["NAPI_RS_NATIVE_LIBRARY_PATH"]).toBeUndefined();
  });
});
