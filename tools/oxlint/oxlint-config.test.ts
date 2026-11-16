import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OxlintConfig } from "oxlint";

import configuration, {
  apiHygieneRules,
  baselineRuleNames,
  baselineRuleSettings,
  baselineTestFileGlobs,
  baselineTestRuleNames,
  baselineTestRuleSettings,
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
      "jest/no-identical-title",
      "local/no-unawaited-async-matcher",
      "local/no-bun-test-only",
    ]);
    const testOverride = config.overrides?.find((override) =>
      override.files.includes("**/*.test.ts"),
    );
    expect(testOverride?.files).toEqual(testFileGlobs);
    expect(testOverride?.plugins).toEqual(["jest"]);
    for (const ruleName of [...testIntegrityRules, ...baselineTestRuleNames]) {
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

const toolingStandardPath = join(repositoryRoot, "docs", "standards", "tooling.md");
const oxcModuleConfigPath = join(repositoryRoot, "registry-src", "oxc", "files", "oxlintrc.json");

/**
 * The `### Oxlint baseline (E10)` section of the tooling standard, up to the next heading.
 */
async function baselineSection(): Promise<string> {
  const text = await Bun.file(toolingStandardPath).text();
  const start = text.indexOf("### Oxlint baseline (E10)");
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n#", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/**
 * Every backticked `scope/rule` name in a Markdown text.
 */
function namedRules(markdown: string): string[] {
  return [...markdown.matchAll(/`((?:typescript|jsdoc|jest|unicorn|local|eslint)\/[a-z-]+)`/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("shared Oxlint baseline (E10)", () => {
  test("aokit's config denies every baseline rule with the baseline setting", () => {
    expect(baselineRuleNames.length).toBeGreaterThan(80);
    for (const [ruleName, setting] of Object.entries(baselineRuleSettings)) {
      expect(config.rules?.[ruleName]).toEqual(setting);
    }
    expect(baselineRuleSettings["typescript/return-await"]).toEqual(["error", "in-try-catch"]);
  });

  test("every rule the tooling standard names is in the exported baseline", async () => {
    const named = namedRules(await baselineSection());
    expect(named.length).toBeGreaterThan(10);
    const exported = new Set([...baselineRuleNames, ...baselineTestRuleNames]);
    expect(named.filter((ruleName) => !exported.has(ruleName))).toEqual([]);
  });

  test("the oxc Module ships exactly the exported baseline", async () => {
    const shipped: unknown = await Bun.file(oxcModuleConfigPath).json();
    expect(shipped).toMatchObject({
      jsPlugins: ["./oxlint-plugin.ts"],
      options: { typeAware: true, reportUnusedDisableDirectives: "error" },
      rules: baselineRuleSettings,
      overrides: [
        { files: baselineTestFileGlobs, plugins: ["jest"], rules: baselineTestRuleSettings },
      ],
    });
    expect(shipped).toHaveProperty("rules", baselineRuleSettings);
  });
});

const oxcModulePluginPath = join(
  repositoryRoot,
  "registry-src",
  "oxc",
  "files",
  "oxlint-plugin.ts",
);
const installedOxlintPath = join(repositoryRoot, "node_modules", "oxlint");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a JSON object file, failing the test when it is not an object.
 */
async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  const parsed: unknown = await Bun.file(path).json();
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

/**
 * The string at `keys` inside a JSON object, or `undefined` when the path is missing.
 */
function stringAt(value: unknown, keys: readonly string[]): string | undefined {
  let current = value;
  for (const key of keys) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * The oxlint range the latest Release Catalog pins for generated Projects.
 */
async function latestCatalogOxlintPin(): Promise<string | undefined> {
  const index = await readJsonObject(join(repositoryRoot, "registry", "index.json"));
  const release = stringAt(index, ["release"]);
  if (release === undefined) throw new Error("registry/index.json names no release");
  const catalog = await readJsonObject(
    join(repositoryRoot, "registry-src", "catalog", `${release}.json`),
  );
  return stringAt(catalog, ["dependencies", "oxlint"]);
}

/**
 * Runs the installed oxlint, the one the baseline is validated against, on a one-line source file
 * with `lintConfig` as its configuration next to the oxc Module's jsPlugin. Type-aware linting is
 * turned off: oxlint checks every rule name while it parses the configuration, before linting.
 */
async function lintWithConfig(lintConfig: unknown): Promise<{ exitCode: number; output: string }> {
  const scratchDirectory = await mkdtemp(join(tmpdir(), "aokit-oxlint-baseline-"));
  try {
    await Bun.write(join(scratchDirectory, ".oxlintrc.json"), JSON.stringify(lintConfig));
    await copyFile(oxcModulePluginPath, join(scratchDirectory, "oxlint-plugin.ts"));
    await Bun.write(join(scratchDirectory, "empty.ts"), "export const answer = 42;\n");
    const lintProcess = Bun.spawn(
      [
        process.execPath,
        join(installedOxlintPath, "bin", "oxlint"),
        "--config",
        ".oxlintrc.json",
        "empty.ts",
      ],
      { cwd: scratchDirectory, stdout: "pipe", stderr: "pipe" },
    );
    const [standardOutput, standardError, exitCode] = await Promise.all([
      new Response(lintProcess.stdout).text(),
      new Response(lintProcess.stderr).text(),
      lintProcess.exited,
    ]);
    return { exitCode, output: standardOutput + standardError };
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true });
  }
}

/**
 * The shipped baseline with type-aware linting off, so no `oxlint-tsgolint` binary is needed.
 */
async function shippedBaselineWithoutTypeAware(): Promise<Record<string, unknown>> {
  const shipped = await readJsonObject(oxcModuleConfigPath);
  const options = isRecord(shipped.options) ? shipped.options : {};
  return { ...shipped, options: { ...options, typeAware: false } };
}

describe("Catalog oxlint pin (F-002)", () => {
  test("the latest Catalog pins the oxlint the baseline is validated against", async () => {
    const installed = await readJsonObject(join(installedOxlintPath, "package.json"));
    const installedVersion = stringAt(installed, ["version"]);
    expect(installedVersion).toBeDefined();
    const rootManifest = await readJsonObject(join(repositoryRoot, "package.json"));
    expect(stringAt(rootManifest, ["devDependencies", "oxlint"])).toBe(installedVersion);
    expect(await latestCatalogOxlintPin()).toBe(installedVersion);
  });

  test("the pinned oxlint knows every rule the shipped baseline names", async () => {
    const result = await lintWithConfig(await shippedBaselineWithoutTypeAware());
    expect(result.output).not.toContain("not found in plugin");
    expect(result.exitCode, result.output).toBe(0);
  });

  test("a baseline rule the pinned oxlint lacks fails the check", async () => {
    const baseline = await shippedBaselineWithoutTypeAware();
    const rules = isRecord(baseline.rules) ? baseline.rules : {};
    const result = await lintWithConfig({
      ...baseline,
      rules: { ...rules, "typescript/no-rule-from-a-newer-oxlint": "error" },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("not found in plugin");
  });
});
