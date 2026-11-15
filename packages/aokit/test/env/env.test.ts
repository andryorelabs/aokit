import { describe, expect, test } from "bun:test";
import { join, relative } from "node:path";

import { Glob } from "bun";

import { childEnvironment } from "../../../create-aokit/src/env.ts";
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

const packagesRoot = join(import.meta.dir, "..", "..", "..");
const environmentModule = /(?:^|\/)env\.ts$/;
const environmentReader = /\b(?:process|Bun)\.env\b/;

async function filesReadingTheEnvironment(): Promise<string[]> {
  const offenders: string[] = [];
  for await (const path of new Glob("*/src/**/*.ts").scan({ cwd: packagesRoot, absolute: true })) {
    const name = relative(packagesRoot, path).replaceAll("\\", "/");
    if (environmentModule.test(name)) continue;
    const text = await Bun.file(path).text();
    const readsCode = text
      .split("\n")
      .some((line) => !/^\s*(?:\/\/|\/?\*)/.test(line) && environmentReader.test(line));
    if (readsCode) offenders.push(name);
  }
  return offenders.toSorted();
}

describe("environment module", () => {
  test("no source file outside an env module reads the process environment", async () => {
    const offenders = await filesReadingTheEnvironment();
    expect(
      offenders,
      `read process.env or Bun.env outside an env module: ${offenders.join(", ")}`,
    ).toEqual([]);
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

  test("the create-aokit child environment keeps the process environment and disables the notice", () => {
    const environment = childEnvironment();
    expect(environment.AOKIT_NO_UPDATE_NOTIFIER).toBe("1");
    expect(environment.PATH).toBe(process.env.PATH);
  });

  test("the native library path is set and cleared", () => {
    setNativeLibraryPath("/tmp/lib");
    expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toBe("/tmp/lib");
    clearNativeLibraryPath();
    expect(process.env.NAPI_RS_NATIVE_LIBRARY_PATH).toBeUndefined();
  });
});
