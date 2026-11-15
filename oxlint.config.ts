import { defineConfig } from "oxlint";

/**
 * Rules that make a floating, mis-handled or lost promise a build failure.
 * An unhandled rejection or an unawaited assertion fails silently, so each of
 * these is an error and never a warning.
 */
export const promiseSafetyRules = [
  "typescript/no-floating-promises",
  "typescript/no-misused-promises",
  "typescript/require-await",
  "typescript/prefer-promise-reject-errors",
  "typescript/use-unknown-in-catch-callback-variable",
] as const;

/**
 * Rules that stop `any` from leaking out of untyped boundaries (JSON, catch
 * clauses, third-party types) into typed code, where it would switch off the
 * checker without a visible cast.
 */
export const noUnsafeAnyRules = [
  "typescript/no-unsafe-assignment",
  "typescript/no-unsafe-member-access",
  "typescript/no-unsafe-call",
  "typescript/no-unsafe-return",
  "typescript/no-unsafe-argument",
] as const;

/**
 * Rules that keep control flow and thrown values exhaustive and explicit:
 * every union member is handled, only `Error` values are thrown, and dead
 * conditions are removed instead of left as noise.
 */
export const exhaustivenessRules = [
  "typescript/only-throw-error",
  "typescript/switch-exhaustiveness-check",
  "typescript/no-unnecessary-condition",
] as const;

/**
 * Rules for API hygiene: no deprecated calls, no template literals that print
 * `[object Object]`, and type-only imports written as `import type` so the
 * emitted JavaScript matches `verbatimModuleSyntax`.
 */
export const apiHygieneRules = [
  "typescript/no-deprecated",
  "typescript/restrict-template-expressions",
  "typescript/consistent-type-imports",
] as const;

/**
 * Rules for the suppression system itself. A blanket `eslint-disable` hides
 * every rule in a file, so it is banned, and the local rule requires a reason
 * on every directive that remains.
 */
export const suppressionRules = [
  "unicorn/no-abusive-eslint-disable",
  "local/require-description",
] as const;

/**
 * Rules that stop a test run from passing by not running its tests: a focused
 * test skips its siblings and a disabled test is never executed. The local
 * rule requires async assertions to be awaited or returned.
 */
export const testIntegrityRules = [
  "jest/no-focused-tests",
  "jest/no-disabled-tests",
  "jest/no-identical-title",
  "local/no-unawaited-async-matcher",
  "local/no-bun-test-only",
] as const;

/**
 * Every rule of the typescript-eslint `strictTypeChecked` preset that Oxlint
 * implements. Extension rules that Oxlint ships under the `eslint` scope are
 * listed under that scope.
 */
export const strictTypeCheckedRules = [
  "typescript/await-thenable",
  "typescript/ban-ts-comment",
  "eslint/no-array-constructor",
  "typescript/no-array-delete",
  "typescript/no-base-to-string",
  "typescript/no-confusing-void-expression",
  "typescript/no-deprecated",
  "typescript/no-duplicate-enum-values",
  "typescript/no-duplicate-type-constituents",
  "typescript/no-dynamic-delete",
  "typescript/no-empty-object-type",
  "typescript/no-explicit-any",
  "typescript/no-extra-non-null-assertion",
  "typescript/no-extraneous-class",
  "typescript/no-floating-promises",
  "typescript/no-for-in-array",
  "typescript/no-implied-eval",
  "typescript/no-invalid-void-type",
  "typescript/no-meaningless-void-operator",
  "typescript/no-misused-new",
  "typescript/no-misused-promises",
  "typescript/no-misused-spread",
  "typescript/no-mixed-enums",
  "typescript/no-namespace",
  "typescript/no-non-null-asserted-nullish-coalescing",
  "typescript/no-non-null-asserted-optional-chain",
  "typescript/no-non-null-assertion",
  "typescript/no-redundant-type-constituents",
  "typescript/no-require-imports",
  "typescript/no-this-alias",
  "typescript/no-unnecessary-boolean-literal-compare",
  "typescript/no-unnecessary-condition",
  "typescript/no-unnecessary-template-expression",
  "typescript/no-unnecessary-type-arguments",
  "typescript/no-unnecessary-type-assertion",
  "typescript/no-unnecessary-type-conversion",
  "typescript/no-useless-default-assignment",
  "typescript/no-unsafe-enum-assignment",
  "typescript/no-generated-empty-object-type",
  "typescript/no-unnecessary-type-constraint",
  "typescript/no-unnecessary-type-parameters",
  "typescript/no-unsafe-argument",
  "typescript/no-unsafe-assignment",
  "typescript/no-unsafe-call",
  "typescript/no-unsafe-declaration-merging",
  "typescript/no-unsafe-enum-comparison",
  "typescript/no-unsafe-function-type",
  "typescript/no-unsafe-member-access",
  "typescript/no-unsafe-return",
  "typescript/no-unsafe-unary-minus",
  "eslint/no-unused-expressions",
  "eslint/no-unused-vars",
  "eslint/no-useless-constructor",
  "typescript/no-wrapper-object-types",
  "typescript/only-throw-error",
  "typescript/prefer-as-const",
  "typescript/prefer-literal-enum-member",
  "typescript/prefer-namespace-keyword",
  "typescript/prefer-promise-reject-errors",
  "typescript/prefer-reduce-type-parameter",
  "typescript/prefer-return-this-type",
  "typescript/related-getter-setter-pairs",
  "typescript/require-await",
  "typescript/restrict-plus-operands",
  "typescript/restrict-template-expressions",
  "typescript/return-await",
  "typescript/triple-slash-reference",
  "typescript/unbound-method",
  "typescript/unified-signatures",
  "typescript/use-unknown-in-catch-callback-variable",
] as const;

/**
 * Every rule of the typescript-eslint `stylisticTypeChecked` preset that
 * Oxlint implements.
 */
export const stylisticTypeCheckedRules = [
  "typescript/adjacent-overload-signatures",
  "typescript/array-type",
  "typescript/ban-tslint-comment",
  "typescript/class-literal-property-style",
  "typescript/consistent-generic-constructors",
  "typescript/consistent-indexed-object-style",
  "typescript/consistent-type-assertions",
  "typescript/consistent-type-definitions",
  "typescript/dot-notation",
  "typescript/no-confusing-non-null-assertion",
  "eslint/no-empty-function",
  "typescript/no-inferrable-types",
  "typescript/non-nullable-type-assertion-style",
  "typescript/prefer-find",
  "typescript/prefer-for-of",
  "typescript/prefer-function-type",
  "typescript/prefer-includes",
  "typescript/prefer-nullish-coalescing",
  "typescript/prefer-optional-chain",
  "typescript/prefer-regexp-exec",
  "typescript/prefer-string-starts-ends-with",
] as const;

/**
 * The JSDoc content rules: tags are known, tag bodies are present where
 * needed and absent where not, and defaults live in code, not in prose.
 */
export const jsdocContentRules = [
  "jsdoc/check-tag-names",
  "jsdoc/empty-tags",
  "jsdoc/implements-on-classes",
  "jsdoc/no-defaults",
  "jsdoc/require-param-name",
  "jsdoc/require-property-name",
  "jsdoc/require-returns-description",
] as const;

/**
 * A rule severity with its options, as Oxlint reads it.
 */
type RuleWithOptions = ["error", ...unknown[]];

/**
 * A rule setting in the shared baseline: always an error, with options when
 * the rule needs them.
 */
export type BaselineRuleSetting = "error" | RuleWithOptions;

/**
 * Rules whose baseline setting carries options. Every other baseline rule is
 * a plain `"error"`.
 */
export const baselineRuleOptions: Readonly<Record<string, RuleWithOptions>> = {
  "typescript/return-await": ["error", "in-try-catch"],
};

/**
 * Builds a baseline rule map: every rule is an error, with its options when
 * `baselineRuleOptions` lists them.
 */
function baselineRules(ruleNames: readonly string[]): Record<string, BaselineRuleSetting> {
  return Object.fromEntries(
    ruleNames.map((ruleName) => [ruleName, baselineRuleOptions[ruleName] ?? "error"]),
  );
}

/**
 * The shared Oxlint baseline (standard rule E10) for every file. Peers copy it
 * into their `oxlint.config.ts`, the `oxc` Module ships it in `.oxlintrc.json`,
 * and drift tests compare both against this list.
 */
export const baselineRuleNames = [
  ...new Set<string>([
    ...strictTypeCheckedRules,
    ...stylisticTypeCheckedRules,
    "typescript/switch-exhaustiveness-check",
    "typescript/no-explicit-any",
    "typescript/return-await",
    "typescript/consistent-type-imports",
    "typescript/no-unnecessary-condition",
    ...jsdocContentRules,
    "unicorn/no-abusive-eslint-disable",
    "local/require-description",
  ]),
];

/**
 * The shared Oxlint baseline for test files only: no focused tests, including
 * `.only` on functions imported from `bun:test`, no duplicate titles, and no
 * unawaited async matcher.
 */
export const baselineTestRuleNames = [
  "jest/no-focused-tests",
  "jest/no-identical-title",
  "local/no-bun-test-only",
  "local/no-unawaited-async-matcher",
];

/**
 * Globs of test files in a generated Project. The baseline test rules apply to
 * these files only.
 */
export const baselineTestFileGlobs = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/test/**/*.ts",
];

/**
 * The baseline rule map for every file.
 */
export const baselineRuleSettings = baselineRules(baselineRuleNames);

/**
 * The baseline rule map for test files.
 */
export const baselineTestRuleSettings = baselineRules(baselineTestRuleNames);

/**
 * Builds a rule map that sets every listed rule to `error`.
 */
function errorRules(ruleNames: readonly string[]): Record<string, "error"> {
  return Object.fromEntries(ruleNames.map((ruleName) => [ruleName, "error"]));
}

/**
 * Globs of test files. Test-integrity rules apply to these files only.
 */
export const testFileGlobs = ["**/*.test.ts", "**/*.test.tsx", "**/test/**/*.ts"];

/**
 * Paths Oxlint never reads: agent worktrees and state, the generated Registry,
 * dependencies, coverage output and build output. Generated Projects keep their
 * own `.oxlintrc.json` under `registry-src/oxc`, which is not linted here as a
 * config but as a source file like the rest of `registry-src`.
 */
export const ignoredPaths = [
  ".claude/**",
  ".emet/**",
  "registry/**",
  "**/node_modules/**",
  "coverage/**",
  "dist/**",
];

/**
 * The aokit repo lint policy ([ADR 0022](docs/adr/0022-repo-lint-config-is-typescript.md)).
 *
 * - `plugins`: the built-in Rust plugins that cover TypeScript, unicorn, oxc,
 *   import, jsdoc, promise and node rules; `jest` is added for test files only.
 * - `categories`: correctness, suspicious and perf are errors, so a new rule
 *   in those categories fails CI instead of being silently adopted as a warning.
 * - `options`: type-aware linting and warnings-as-errors are part of the
 *   config, and an unused disable directive is an error so suppressions that
 *   stop being needed are deleted.
 */
export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc", "import", "jsdoc", "promise", "node"],
  jsPlugins: ["./tools/oxlint/local-plugin.ts"],
  categories: {
    correctness: "error",
    suspicious: "error",
    perf: "error",
  },
  options: {
    typeAware: true,
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
  },
  rules: {
    ...baselineRuleSettings,
    "local/no-non-doc-comments": "error",
    ...errorRules(promiseSafetyRules),
    ...errorRules(noUnsafeAnyRules),
    ...errorRules(exhaustivenessRules),
    ...errorRules(apiHygieneRules),
    ...errorRules(suppressionRules),
  },
  overrides: [
    {
      files: testFileGlobs,
      plugins: ["jest"],
      rules: { ...baselineTestRuleSettings, ...errorRules(testIntegrityRules) },
    },
  ],
  ignorePatterns: ignoredPaths,
});
