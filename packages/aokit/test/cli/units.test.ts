import { describe, expect, test } from "bun:test";
import { isColorEnabled } from "../../src/cli/color.ts";
import {
  AokitError,
  exitCodeForEnvelope,
  errorPayloadFrom,
  stringifySorted,
} from "../../src/cli/envelope.ts";
import { errorCodeExitCodes, exitCodeForErrorCode } from "../../src/cli/exit-codes.ts";
import { registerShutdownHook, runShutdownHooks } from "../../src/cli/shutdown.ts";

describe("exit-code mapping", () => {
  test("maps error codes to the cli-ux table", () => {
    expect(exitCodeForErrorCode("INVALID_INPUT")).toBe(3);
    expect(exitCodeForErrorCode("CAPABILITY_CONFLICT")).toBe(4);
    expect(exitCodeForErrorCode("DIRTY_TREE")).toBe(5);
    expect(exitCodeForErrorCode("MERGE_CONFLICTS")).toBe(6);
    expect(exitCodeForErrorCode("INTERRUPTED")).toBe(130);
    expect(exitCodeForErrorCode("INTERNAL")).toBe(1);
  });

  test("unknown codes are failures and only UPDATE_AVAILABLE and REGISTRY_ENV_UNSET map to 2", () => {
    expect(exitCodeForErrorCode("SOMETHING_NEW")).toBe(1);
    expect(exitCodeForErrorCode("toString")).toBe(1);
    const mappedToTwo = Object.entries(errorCodeExitCodes)
      .filter(([, exitCode]) => exitCode === 2)
      .map(([code]) => code);
    expect(mappedToTwo).toEqual(["UPDATE_AVAILABLE", "REGISTRY_ENV_UNSET"]);
  });

  test("an envelope maps through its error code", () => {
    const failure = errorPayloadFrom(new AokitError("REQUIREMENT_UNMET", "m", "f"));
    expect(exitCodeForEnvelope({ ok: false, data: null, error: failure })).toBe(4);
    expect(exitCodeForEnvelope({ ok: true, data: 1, error: null })).toBe(0);
  });

  test("unexpected throws become INTERNAL", () => {
    expect(errorPayloadFrom(new Error("boom")).code).toBe("INTERNAL");
  });
});

describe("stringifySorted", () => {
  test("sorts keys at every level", () => {
    expect(stringifySorted({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":1},"b":1}',
    );
  });
});

describe("color", () => {
  const tty = { isTTY: true, noColorFlag: false };
  test("is on for a plain TTY", () => {
    expect(isColorEnabled({ env: {}, ...tty })).toBe(true);
  });
  test("NO_COLOR disables it even with FORCE_COLOR", () => {
    expect(isColorEnabled({ env: { NO_COLOR: "1", FORCE_COLOR: "1" }, ...tty })).toBe(false);
  });
  test("an empty NO_COLOR is ignored", () => {
    expect(isColorEnabled({ env: { NO_COLOR: "" }, ...tty })).toBe(true);
  });
  test("non-TTY, --no-color and TERM=dumb disable it", () => {
    expect(isColorEnabled({ env: {}, isTTY: false, noColorFlag: false })).toBe(false);
    expect(isColorEnabled({ env: {}, isTTY: true, noColorFlag: true })).toBe(false);
    expect(isColorEnabled({ env: { TERM: "dumb" }, ...tty })).toBe(false);
  });
  test("FORCE_COLOR wins over a non-TTY", () => {
    expect(isColorEnabled({ env: { FORCE_COLOR: "1" }, isTTY: false, noColorFlag: false })).toBe(
      true,
    );
  });
});

describe("shutdown hooks", () => {
  test("run once in order, and a failing hook does not block the rest", async () => {
    const calls: string[] = [];
    registerShutdownHook(() => {
      calls.push("first");
    });
    registerShutdownHook(() => {
      throw new Error("hook failure");
    });
    registerShutdownHook(async () => {
      calls.push("third");
    });
    await runShutdownHooks();
    await runShutdownHooks();
    expect(calls).toEqual(["first", "third"]);
  });

  test("an unregistered hook does not run", async () => {
    let ran = false;
    const unregister = registerShutdownHook(() => {
      ran = true;
    });
    unregister();
    await runShutdownHooks();
    expect(ran).toBe(false);
  });
});
