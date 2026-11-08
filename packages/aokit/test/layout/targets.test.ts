import { expect, test } from "bun:test";
import { targetSchema } from "@aokit/module";
import { headerTargets, renderHeader } from "../../src/engine/agent-files.ts";
import { layoutTables, resolveTarget } from "../../src/engine/layout.ts";

const newTargets = ["lib", "api-client", "extension", "emails", "jobs"] as const;

const singlePaths = {
  lib: "",
  "api-client": "src/api-client",
  extension: "extension",
  emails: "src/emails",
  jobs: "",
};

const monorepoPaths = {
  lib: "packages/lib",
  "api-client": "packages/api-client",
  extension: "apps/extension",
  emails: "packages/emails",
  jobs: "packages/jobs",
};

test("the closed Target schema accepts the new Targets", () => {
  for (const target of newTargets) {
    expect(targetSchema.safeParse(target).success).toBe(true);
  }
  expect(targetSchema.safeParse("unknown").success).toBe(false);
});

test("the single Layout resolves the new Targets", () => {
  for (const target of newTargets) {
    expect(resolveTarget("single", target)).toBe(singlePaths[target]);
  }
});

test("the monorepo Layout resolves the new Targets", () => {
  for (const target of newTargets) {
    expect(resolveTarget("monorepo", target)).toBe(monorepoPaths[target]);
  }
});

test("both Layout tables cover every Target", () => {
  expect(Object.keys(layoutTables.single).toSorted()).toEqual(targetSchema.options.toSorted());
  expect(Object.keys(layoutTables.monorepo).toSorted()).toEqual(targetSchema.options.toSorted());
});

test("the header Target table stays at the six core Targets", () => {
  expect(headerTargets).toEqual(["root", "config", "web", "server", "db", "shared-ui"]);
  for (const layout of ["single", "monorepo"] as const) {
    const header = renderHeader(layout);
    for (const target of newTargets) {
      expect(header).not.toContain(`\`${target}\``);
    }
    for (const target of headerTargets) {
      expect(header).toContain(`\`${target}\``);
    }
  }
});
