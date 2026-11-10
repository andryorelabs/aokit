import { expect, test } from "bun:test";
import { asDiagnosticData } from "../../src/cli/envelope.ts";
import { renderFailureReport } from "../../src/cli/human.ts";

test("diagnostic failure data is hidden unless verbose", () => {
  const data = asDiagnosticData({ resolverCode: "unknown_module" });
  expect(renderFailureReport(data)).toBe("");
  expect(renderFailureReport(data, false)).toBe("");
  expect(renderFailureReport(data, true)).toContain('"resolverCode": "unknown_module"');
});

test("report data still renders without verbose", () => {
  expect(renderFailureReport({ a: 1 })).toContain('"a": 1');
});
