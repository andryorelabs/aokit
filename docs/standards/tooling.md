# Tooling

The default lint and format toolchain is Oxc, with a small ESLint companion for what Oxlint cannot yet do. It is encoded by the `oxc`, `eslint` companion, `commitlint`, `husky`, `lint-staged`, `knip`, `playwright` and `axe` Modules in the [module catalog](../architecture/module-catalog.md). TypeScript is in [typescript](typescript.md), version policy in [renovate](renovate.md). Index: [standards](README.md).

## Oxc default

- **Formatter:** Oxfmt.
- **Linter:** Oxlint with `--type-aware`.
- **Original rules:** the original `unicorn` and `jsdoc` rules, and project-local rules, run through Oxlint `jsPlugins` aliases. The aliases keep the upstream rule names, so no rule is lost in the move.
- **Never relax a rule to pass.** A migration that cannot run a rule keeps it elsewhere (the companion below) or fixes the code. Lowering severity, disabling a rule or narrowing its scope to get a green run is not allowed.
- **Oxfmt formats every file type** it recognizes, including Markdown, JSON and Astro. Set `ignorePatterns` explicitly so generated files, lockfiles, vendored assets and content that must stay byte-exact are never rewritten.
- **Do not trust migration helpers blindly.** `@oxlint/migrate` and `oxfmt --migrate` produce configurations that can drop rules or change meaning (broken configs have been observed). Treat their output as a draft and verify it with the parity gate.
- **Known limits:** Oxlint overrides have no `ignores` key, and a plugin's `context` is frozen, so some ESLint rules need an alternative.
- **Pinning:** the oxc packages are a Toolchain pin group, exact, and never automerged ([renovate](renovate.md)).

### Differential parity gate

ESLint is cut only after a differential parity run shows the Oxc setup reports the same violations. The gate compares findings per file, line and rule between the old ESLint run and the new Oxlint run, over the whole repository including fixtures with known violations. Any difference is either fixed in the new setup, kept in the companion, or recorded as an accepted gap in an ADR. The gate stays in the repository so it can re-run when Oxc is bumped.

## The `eslint` companion

ESLint stays as a companion, not as the main linter. It runs with the full project rule set where Oxlint cannot:

- on `**/*.astro`: every rule the project applies elsewhere (accessibility, unicorn and the rest, through the Astro parser), not only the `astro/*` rules;
- the type-aware rules Oxlint cannot run, for example a rule against leaking conditionals in rendered output on `**/*.tsx`.

A repository without `.astro` files may instead use a type-program shim for such a rule and drop the companion. The companion reads the same `ignorePatterns` as Oxlint where possible, and its rule list shrinks as Oxlint gains support. The companion's `lint` runs in the same hook and CI step as Oxlint.

## The aokit repo's own lint config (aokit only)

This section describes aokit's own repository and is not a rule for other repos; their lint config follows the baseline in E10.

The aokit repo configures Oxlint in `oxlint.config.ts` (`defineConfig`) and Knip in `knip.jsonc`. Generated Projects keep `.oxlintrc.json` and `knip.json` from the `oxc` and `knip` Modules. The two are independent ([ADR 0022](../adr/0022-repo-lint-config-is-typescript.md)).

- **Rule groups:** every group in `oxlint.config.ts` is an exported constant with a TSDoc rationale: promise safety, no unsafe `any`, exhaustiveness, API hygiene, suppression and test integrity. A test imports the config and asserts these policies.
- **Strict rule set:** the type-aware `typescript/*` rules above, plus `unicorn/no-abusive-eslint-disable`, are errors. The categories `correctness`, `suspicious` and `perf` are errors, and `options` turns on type-aware linting and warnings-as-errors.
- **Unused directives are errors:** `options.reportUnusedDisableDirectives` is `"error"`, so a suppression that stops being needed is deleted.
- **Every disable directive needs a reason:** `local/require-description` requires ` -- <reason>` on each `oxlint-disable` or `eslint-disable` comment. A file-level blanket disable also suppresses this rule, which is why `unicorn/no-abusive-eslint-disable` is on.
- **Test files only:** `jest/no-focused-tests`, `jest/no-disabled-tests` and `local/no-unawaited-async-matcher` (an `expect(...).rejects` or `.resolves` must be awaited or returned). Oxlint's jest rules do not see `test.only` when `test` is imported from `bun:test`, so that import form is not covered by the jest rules.
- **Local rules** live in `tools/oxlint/local-plugin.ts` with a test per rule, and load as the `local` jsPlugin.
- **Knip:** `knip.jsonc` carries a reason on every entry, ignore and `ignoreDependencies` line.
- **TypeScript:** `tsconfig.base.json` sets `erasableSyntaxOnly`, so enums, namespaces and parameter properties are rejected.
- **Blame:** `.git-blame-ignore-revs` lists the lint-debt squash commits; enable it with `git config blame.ignoreRevsFile .git-blame-ignore-revs`.

## Scripts and configuration rules

- **E1** (must) Root scripts are `check` (typecheck, lint, `format:check` and knip at minimum, offline-safe), `test` (with the coverage gate; `test:coverage` in browser mode), `fix`, `format:check`, `format:write`, `lint:docs`, `lint:commits` and `ci:local`, and CI and hooks call these scripts. Reason: every repo runs the same commands.
- **E5** (should) A repo configures Oxlint in `oxlint.config.ts`, Knip in `knip.jsonc` with a reason on each entry, and commitlint in `commitlint.config.ts`. Reason: typed, commented config is checked by the compiler.
- **E6** (must) Oxc is pinned exactly and equal across repos, every lint disable carries a reason, and TSDoc-only comments are enforced by lint. Reason: one Oxc version reports the same violations everywhere.
- **E7** (should) The default gitmoji per type is feat ✨, fix 🐛, docs 📝, refactor ♻️, perf ⚡️, test ✅, build 📦, ci 👷, chore 🔧, deps ⬆️, release 🔖 and revert ⏪. Reason: the same type reads the same in every history.
- **E8** (must) Oxfmt keeps its defaults for every style option, the only allowed keys are `ignorePatterns`, `sortImports`, `sortTailwindcss`, `sortPackageJson` and `astro`, and the import group order should match across repos. Reason: formatting is never a per-repo debate.

## Rules from standard v2

Each rule is marked **must**, **should** or **may**, names the project types it applies to, gives one sentence, then the reason. The type words are in the [legend](README.md#levels-and-project-types).

- **E10** (V16, must, TS) One shared Oxlint baseline is encoded in aokit's `oxc` Module and copied by every repo into its `oxlint.config.ts`, with a per-repo drift test; violations are fixed, never disabled. The rules are in [the baseline](#oxlint-baseline-e10). Reason: one rule set catches the same bugs everywhere (five bare `.rejects` that could never fail were found this way).
- **E11** (V17, must, while Oxlint and ESLint coexist) A `lint:parity` differential gate runs with an accepted-differences fixture. Reason: the gate in [Differential parity gate](#differential-parity-gate) stays executable.
- **E12** (V18, should, TS) One lint-policy module is consumed by both linters, and the lint config itself has a test. Reason: the two linters cannot disagree.
- **E13** (V19, must, all) The format scope includes `.mts`, `.cts` and `.jsonc`, and one `sortImports` group order is used, set in aokit (below). Reason: no file type or import order is a per-repo debate.
- **E14** (V20, should, TS) The tsconfig `include` covers root `*.ts` and `*.mts` config files. Reason: config files are type-checked like source.
- **E15** (V21, must, all) One toolchain version table lives in aokit (below), every pin is Renovate-managed, and each repo has a drift check against the table. Reason: one version of each tool reports the same results everywhere.
- **E16** (V22, must, all) Hooks are written in TypeScript with tests: pre-push refuses `main` and `develop` and checks the branch name, and the hook files are tested. Reason: a hook that is not tested stops working unseen.
- **E17** (V23, must, all) `lint:commits` checks the whole pull request range, not `--last`. Reason: a bad older commit on a branch must fail.
- **E18** (V24, should, all) Script names are `lint:fix`, `test:coverage`, `cache:clear` and, for bilingual repos, `i18n:status`; `ci:audit` is optional. Reason: the same command does the same thing in every repo.

### Oxlint baseline (E10)

Peers copy this list into their `oxlint.config.ts` as error-level rules, and a drift test compares the copy to aokit's exported list. The type-aware rules need `options.typeAware`.

- the equivalents of the typescript-eslint `strictTypeChecked` and `stylisticTypeChecked` presets, every rule Oxlint implements from either one;
- `typescript/switch-exhaustiveness-check`;
- `typescript/no-explicit-any`;
- `typescript/return-await`, option `"in-try-catch"`;
- `typescript/consistent-type-imports`;
- `typescript/no-unnecessary-condition`;
- the JSDoc content rules, from the `jsdoc` plugin: `jsdoc/check-tag-names`, `jsdoc/empty-tags`, `jsdoc/implements-on-classes`, `jsdoc/no-defaults`, `jsdoc/require-param-name`, `jsdoc/require-property-name` and `jsdoc/require-returns-description`;
- the eslint-comments hygiene set: `unicorn/no-abusive-eslint-disable`, `options.reportUnusedDisableDirectives` set to `"error"`, and `local/require-description` (a reason on every disable);
- `local/no-unawaited-async-matcher` (an `expect(...).rejects` or `.resolves` is awaited or returned);
- `jest/no-identical-title`;
- the focused-test ban: `jest/no-focused-tests` plus a rule that rejects `.only` on `test`, `it` and `describe` imported from `bun:test`, which the jest rules do not see.

### sortImports (E13)

```json
{
  "groups": ["builtin", "external", "internal", ["parent", "sibling", "index"], "unknown"],
  "internalPattern": ["@/"],
  "ignoreCase": true,
  "newlinesBetween": true
}
```

Astro repos add `customGroups` and this group order:

```json
{
  "customGroups": [
    { "groupName": "astro", "elementNamePattern": ["astro", "astro/**", "astro:*"] }
  ],
  "groups": [
    "builtin",
    { "newlinesBetween": false },
    "astro",
    { "newlinesBetween": false },
    "external",
    "internal",
    ["parent", "sibling", "index"],
    "unknown"
  ]
}
```

### Toolchain versions (E15)

| Tool                        | Version                                             |
| --------------------------- | --------------------------------------------------- |
| `oxlint`                    | 1.92.0                                              |
| `@oxlint/plugins`           | 1.92.0                                              |
| `oxfmt`                     | 0.75.0                                              |
| `oxlint-tsgolint`           | 7.0.2005                                            |
| `typescript7`               | `npm:typescript@7.1.0-beta`                         |
| `typescript`                | `npm:@typescript/typescript6@6.0.2`                 |
| Bun (`packageManager`)      | `bun@1.4.4`                                         |
| `@types/bun`                | 1.4.4                                               |
| `.node-version`             | 26                                                  |
| actionlint                  | 1.7.12                                              |
| zizmor                      | 1.32.0                                              |
| `lycheeverse/lychee-action` | `e7477775783ea5526144ba13e8db5eec57747ce8` (v2.9.0) |

## Git hooks and commit messages

- **E4** (must) `husky` runs `lint-staged` in pre-commit and `commitlint` in commit-msg; pre-push refuses trunk branches and names outside `<type>/<slug>`, `<prefix>-<n>-<slug>`, `renovate/*` and `worktree-*`, then runs the typecheck or more, and CI runs commitlint. Reason: a bad branch or message is stopped before it reaches the remote.
- `husky` runs the hooks, `lint-staged` runs Oxfmt and Oxlint on staged files, `commitlint` checks the commit message.
- Commit messages are conventional commits. **Gitmoji is a convention, not enforced:** the common format is `type: <gitmoji> description`, but commitlint does not require the emoji. A repository may add enforcement.
- Hooks never run the full test suite; CI does.

## knip

`knip` reports unused files, exports and dependencies. It runs in CI and, optionally, in a pre-push hook. Entry points and ignores live in the knip config, never in code comments.

## Playwright and axe

`playwright` runs end-to-end tests, and `axe` adds automated accessibility checks to the same suite on the pages that carry the product. Axe finds a subset of accessibility problems, not all of them. The unit and integration `test-runner` (Vitest or `bun test`) is a per-Project choice and is independent of the e2e tooling.

## Comments: TSDoc only

Source comments are TSDoc blocks on declarations. Inline explanatory comments are not allowed: if code needs one, it needs a better name or a smaller function.

- Enforced by a project-local rule, `local/no-non-doc-comments`, loaded as a jsPlugin.
- Tool directives that disable a rule need a reason: `// oxlint-disable-next-line <rule> -- <reason>`.
- The rule **exempts tool directive comments** (for example `oxlint-disable`, `eslint-disable`, `@ts-expect-error`, `istanbul ignore`), because tools read them.
- The rule is an optional Module setting: a Project can omit it.
