import { describe, expect, test } from "bun:test";
import { loadCoverageFloors, parseCoverageFloors, workspaceOf } from "./coverage-floors";

describe("parseCoverageFloors", () => {
  test("reads the all floor and each workspace", () => {
    const floors = parseCoverageFloors(
      JSON.stringify({
        all: { lines: 0.9, functions: 0.8 },
        workspaces: { tools: { lines: 1, functions: 1 } },
      }),
    );
    expect(floors.all).toEqual({ lines: 0.9, functions: 0.8 });
    expect(floors.workspaces.tools).toEqual({ lines: 1, functions: 1 });
  });

  test("rejects a missing section", () => {
    expect(() => parseCoverageFloors("{}")).toThrow("needs");
    expect(() =>
      parseCoverageFloors('{"all":{"lines":1,"functions":1},"workspaces":null}'),
    ).toThrow("needs");
  });

  test("rejects a floor that is not a fraction", () => {
    expect(() => parseCoverageFloors('{"all":{"lines":97,"functions":1},"workspaces":{}}')).toThrow(
      "fractions",
    );
    expect(() => parseCoverageFloors('{"all":null,"workspaces":{}}')).toThrow("all");
  });
});

describe("workspaceOf", () => {
  test("maps paths to their workspace", () => {
    expect(workspaceOf("oxlint.config.ts")).toBe(".");
    expect(workspaceOf("packages/aokit/src/a.ts")).toBe("packages/aokit");
    expect(workspaceOf("tools/coverage/a.ts")).toBe("tools");
    expect(workspaceOf("packages/file.ts")).toBe("packages");
  });
});

describe("committed floors", () => {
  test("load with at least one workspace", () => {
    expect(Object.keys(loadCoverageFloors().workspaces).length).toBeGreaterThan(0);
  });
});
