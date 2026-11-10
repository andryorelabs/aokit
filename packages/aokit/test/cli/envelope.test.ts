import { expect, test } from "bun:test";
import { asDiagnosticData, isDiagnosticData, stringifySorted } from "../../src/cli/envelope.ts";
import { fromResolveError } from "../../src/project/errors.ts";

test("diagnostic data is marked by identity and serializes unchanged", () => {
  const data = asDiagnosticData({ b: 1, a: 2 });
  expect(isDiagnosticData(data)).toBe(true);
  expect(isDiagnosticData({ b: 1, a: 2 })).toBe(false);
  expect(isDiagnosticData(null)).toBe(false);
  expect(stringifySorted(data)).toBe('{"a":2,"b":1}');
});

test("an unknown module Resolver error maps to MODULE_UNKNOWN with diagnostic data", () => {
  const error = fromResolveError({
    code: "unknown_module",
    message: 'module "x" is not in the registry index.',
    fix: "run `aokit list`",
    module: "x",
  });
  expect(error.code).toBe("MODULE_UNKNOWN");
  expect(isDiagnosticData(error.data)).toBe(true);
  expect(error.data).toEqual({ resolverCode: "unknown_module" });
});
