import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineCommand, runCommand } from "../../src/cli/command.ts";
import { AokitError, exitCodeForEnvelope, stringifySorted } from "../../src/cli/envelope.ts";
import { exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { renderFailureReport } from "../../src/cli/human.ts";
import { fromResolveError } from "../../src/create/errors.ts";

describe("lifecycle outcome errors", () => {
  test("lifecycle codes map to exactly one exit code", () => {
    expect(exitCodeForErrorCode("UPDATE_AVAILABLE")).toBe(2);
    expect(exitCodeForErrorCode("DRIFT")).toBe(1);
    expect(exitCodeForErrorCode("NOT_IN_LOCKFILE")).toBe(3);
    expect(exitCodeForErrorCode("MODULE_VERSION_UNAVAILABLE")).toBe(1);
    expect(exitCodeForErrorCode("DEPENDENTS_EXIST")).toBe(4);
    expect(exitCodeForErrorCode("NOT_SELECTED")).toBe(3);
    expect(exitCodeForErrorCode("MERGE_CONFLICTS")).toBe(6);
    expect(exitCodeForErrorCode("MIN_CLI_VERSION")).toBe(5);
  });

  test("a thrown outcome error keeps its report in the envelope", async () => {
    const command = defineCommand({
      name: "probe",
      description: "probe",
      input: z.object({}),
      output: z.object({}),
      run() {
        throw new AokitError("DRIFT", "drifted", "restore it", { files: ["a"] });
      },
    });
    const envelope = await runCommand(command, { version: "0", env: {}, commands: [] }, {});
    expect(stringifySorted(envelope)).toBe(
      '{"data":{"files":["a"]},"error":{"code":"DRIFT","fix":"restore it","message":"drifted"},"ok":false}',
    );
    expect(exitCodeForEnvelope(envelope)).toBe(1);
  });

  test("a Resolver error carries its raw code as data", () => {
    const error = fromResolveError({
      code: "requirement_unmet",
      message: "m",
      fix: "f",
    });
    expect(error.code).toBe("REQUIREMENT_UNMET");
    expect(error.data).toEqual({ resolverCode: "requirement_unmet" });
  });

  test("the human renderer prints the report of an outcome error", () => {
    expect(renderFailureReport({ a: 1 })).toContain('"a": 1');
    expect(renderFailureReport(null)).toBe("");
  });
});
