import { expect, test } from "bun:test";
import { computePlanId, createPlanSession } from "../../src/mcp/plan-id.ts";

test("planId changes with the input, the Release and the VFS hash, not with key order", () => {
  const base = computePlanId({ a: 1, b: [2] }, "2026.11.0", "vfs");
  expect(computePlanId({ b: [2], a: 1 }, "2026.11.0", "vfs")).toBe(base);
  expect(computePlanId({ a: 2, b: [2] }, "2026.11.0", "vfs")).not.toBe(base);
  expect(computePlanId({ a: 1, b: [2] }, "2026.12.0", "vfs")).not.toBe(base);
  expect(computePlanId({ a: 1, b: [2] }, "2026.11.0", "other")).not.toBe(base);
});

test("a planId issued for another tool never matches the same input for create", () => {
  const input = { directory: "/w/app", modules: "oxc" };
  const forAdd = computePlanId({ tool: "add", input }, "r", "vfs");
  const forCreate = computePlanId({ tool: "create", input }, "r", "vfs");
  expect(forAdd).not.toBe(forCreate);
});

test("a session only knows the ids it issued", () => {
  const session = createPlanSession();
  session.issue("plan_a");
  expect(session.has("plan_a")).toBe(true);
  expect(session.has("plan_b")).toBe(false);
  expect(createPlanSession().has("plan_a")).toBe(false);
});

test("a consumed planId is no longer issued", () => {
  const session = createPlanSession();
  session.issue("plan_a");
  session.consume("plan_a");
  expect(session.has("plan_a")).toBe(false);
});
