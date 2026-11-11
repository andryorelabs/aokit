import { describe, expect, test } from "bun:test";
import { parseManifest } from "@aokit/module";
import { ApplyError } from "../../src/apply/index.ts";
import { AokitError } from "../../src/cli/envelope.ts";
import { FormatError } from "../../src/format/index.ts";
import { parseAnswers } from "../../src/project/answers.ts";
import { toAokitError } from "../../src/project/errors.ts";
import { parseSource } from "../../src/project/registry/context.ts";

describe("create run errors", () => {
  test("a format failure becomes an IO_ERROR carrying its code", () => {
    const converted = toAokitError(new FormatError("format.failed", "oxfmt crashed", "rerun"));
    expect(converted).toBeInstanceOf(AokitError);
    expect(converted).toMatchObject({
      code: "IO_ERROR",
      message: "[format.failed] oxfmt crashed",
      fix: "rerun",
    });
  });

  test("an apply failure keeps its own code", () => {
    const converted = toAokitError(new ApplyError("INTERRUPTED", "stopped", "try again"));
    expect(converted).toMatchObject({ code: "INTERRUPTED", message: "stopped", fix: "try again" });
  });

  test("an unknown error is returned as it came", () => {
    const failure = new Error("plain");
    expect(toAokitError(failure)).toBe(failure);
  });
});

describe("number answers", () => {
  const demo = parseManifest({
    name: "demo",
    version: "1.0.0",
    description: "Fixture Module.",
    answers: { count: { type: "number" } },
  });

  test("a non-numeric value is refused naming the flag", () => {
    expect(() => parseAnswers(["demo.count=many"], [demo])).toThrow(
      "--answer demo.count must be a number, got `many`",
    );
  });

  test("a blank value is refused", () => {
    expect(() => parseAnswers(["demo.count= "], [demo])).toThrow("must be a number");
  });

  test("a numeric value is coerced", () => {
    expect(parseAnswers(["demo.count=7"], [demo])).toEqual({ demo: { count: 7 } });
  });
});

describe("registry source parsing", () => {
  test("an empty source is an INVALID_INPUT error", () => {
    const context = { projectDir: "/work", bundledRegistryPath: "/opt/registry" };
    let failure: unknown;
    try {
      parseSource("", context);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AokitError);
    expect(failure).toMatchObject({ code: "INVALID_INPUT" });
  });
});
