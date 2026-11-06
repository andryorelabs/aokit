import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { coverageExemptions } from "./coverage-exemptions";
import {
  collectImportedModules,
  findCoverageProblems,
  listSourceModules,
  listTestFiles,
} from "./coverage-manifest";

const repoRoot = resolve(import.meta.dir, "../..");

describe("findCoverageProblems", () => {
  const modules = ["packages/a/src/one.ts", "packages/a/src/two.ts"];

  test("passes when every module is imported or exempted with a reason", () => {
    const problems = findCoverageProblems({
      modules,
      importedModules: new Set(["packages/a/src/one.ts"]),
      exemptions: { "packages/a/src/two.ts": "covered through the CLI end-to-end tests" },
    });
    expect(problems).toEqual([]);
  });

  test("fails for a module with no importing test and no exemption", () => {
    const problems = findCoverageProblems({
      modules,
      importedModules: new Set(["packages/a/src/one.ts"]),
      exemptions: {},
    });
    expect(problems).toEqual([
      "packages/a/src/two.ts is not imported by any test and has no exemption",
    ]);
  });

  test("fails for an exemption with an empty reason", () => {
    const problems = findCoverageProblems({
      modules,
      importedModules: new Set(["packages/a/src/one.ts"]),
      exemptions: { "packages/a/src/two.ts": "  " },
    });
    expect(problems).toEqual(["exemption for packages/a/src/two.ts has an empty reason"]);
  });

  test("fails for an exemption on a module that a test now imports", () => {
    const problems = findCoverageProblems({
      modules,
      importedModules: new Set(modules),
      exemptions: { "packages/a/src/two.ts": "no test yet" },
    });
    expect(problems).toEqual([
      "exemption for packages/a/src/two.ts is stale: a test now imports it",
    ]);
  });

  test("fails for an exemption on a module that no longer exists", () => {
    const problems = findCoverageProblems({
      modules,
      importedModules: new Set(modules),
      exemptions: { "packages/a/src/gone.ts": "was untestable" },
    });
    expect(problems).toEqual([
      "exemption for packages/a/src/gone.ts is stale: the module does not exist",
    ]);
  });
});

describe("coverage manifest", () => {
  test("every src module is imported by a test or exempted with a reason", () => {
    const modules = listSourceModules(repoRoot);
    expect(modules.length).toBeGreaterThan(0);
    const importedModules = collectImportedModules(repoRoot, listTestFiles(repoRoot));
    expect(
      findCoverageProblems({ modules, importedModules, exemptions: coverageExemptions }),
    ).toEqual([]);
  });
});
