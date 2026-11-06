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
  "local/no-unawaited-async-matcher",
] as const;

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
  ".forge/**",
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
      rules: errorRules(testIntegrityRules),
    },
  ],
  ignorePatterns: ignoredPaths,
});
