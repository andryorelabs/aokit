import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { OxlintConfig } from "oxlint";
import configuration, {
  apiHygieneRules,
  exhaustivenessRules,
  ignoredPaths,
  noUnsafeAnyRules,
  promiseSafetyRules,
  suppressionRules,
  testFileGlobs,
  testIntegrityRules,
} from "../../oxlint.config.ts";

const config: OxlintConfig = configuration;
const repositoryRoot = join(import.meta.dir, "..", "..");

const strictRuleSet = [
  "typescript/no-floating-promises",
  "typescript/no-misused-promises",
  "typescript/no-unsafe-assignment",
  "typescript/no-unsafe-member-access",
  "typescript/no-unsafe-call",
  "typescript/no-unsafe-return",
  "typescript/no-unsafe-argument",
  "typescript/only-throw-error",
  "typescript/switch-exhaustiveness-check",
  "typescript/no-deprecated",
  "typescript/restrict-template-expressions",
  "typescript/require-await",
  "typescript/no-unnecessary-condition",
  "typescript/prefer-promise-reject-errors",
  "typescript/use-unknown-in-catch-callback-variable",
  "typescript/consistent-type-imports",
];

describe("oxlint.config.ts", () => {
  test("reports unused disable directives as errors and runs type-aware", () => {
    expect(config.options?.reportUnusedDisableDirectives).toBe("error");
    expect(config.options?.typeAware).toBe(true);
    expect(config.options?.denyWarnings).toBe(true);
  });

  test("keeps correctness, suspicious and perf categories as errors", () => {
    expect(config.categories).toEqual({
      correctness: "error",
      suspicious: "error",
      perf: "error",
    });
  });

  test("keeps the plugins and the local jsPlugin", () => {
    expect(config.plugins).toEqual([
      "typescript",
      "unicorn",
      "oxc",
      "import",
      "jsdoc",
      "promise",
      "node",
    ]);
    expect(config.jsPlugins).toEqual(["./tools/oxlint/local-plugin.ts"]);
    expect(existsSync(join(repositoryRoot, "tools", "oxlint", "local-plugin.ts"))).toBe(true);
  });

  test("denies every rule of the strict rule set", () => {
    for (const ruleName of strictRuleSet) {
      expect(config.rules?.[ruleName]).toBe("error");
    }
    const grouped: string[] = [
      ...promiseSafetyRules,
      ...noUnsafeAnyRules,
      ...exhaustivenessRules,
      ...apiHygieneRules,
    ];
    expect(grouped.toSorted()).toEqual(strictRuleSet.toSorted());
  });

  test("denies the local rules and the abusive disable rule", () => {
    expect(config.rules?.["local/no-non-doc-comments"]).toBe("error");
    expect(suppressionRules).toEqual([
      "unicorn/no-abusive-eslint-disable",
      "local/require-description",
    ]);
    for (const ruleName of suppressionRules) {
      expect(config.rules?.[ruleName]).toBe("error");
    }
  });

  test("applies the test-integrity rules to test files only", () => {
    expect(testIntegrityRules).toEqual([
      "jest/no-focused-tests",
      "jest/no-disabled-tests",
      "local/no-unawaited-async-matcher",
    ]);
    const testOverride = config.overrides?.find((override) =>
      override.files.includes("**/*.test.ts"),
    );
    expect(testOverride?.files).toEqual(testFileGlobs);
    expect(testOverride?.plugins).toEqual(["jest"]);
    for (const ruleName of testIntegrityRules) {
      expect(testOverride?.rules?.[ruleName]).toBe("error");
      expect(config.rules?.[ruleName]).toBeUndefined();
    }
  });

  test("ignores generated and vendored paths", () => {
    expect(config.ignorePatterns).toEqual(ignoredPaths);
    expect(ignoredPaths).toContain("registry/**");
    expect(ignoredPaths).toContain("**/node_modules/**");
  });

  test("replaced the JSON configs", () => {
    expect(existsSync(join(repositoryRoot, ".oxlintrc.json"))).toBe(false);
    expect(existsSync(join(repositoryRoot, "knip.json"))).toBe(false);
    expect(existsSync(join(repositoryRoot, "knip.jsonc"))).toBe(true);
  });
});
