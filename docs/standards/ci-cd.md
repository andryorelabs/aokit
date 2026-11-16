# CI and CD

GitHub Actions hygiene, the workflow set, runners and the release flow. Index: [standards](README.md). Dependency updates are in [renovate](renovate.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

Each rule is marked **must** or **should**, gives one sentence, then the reason. Rules from standard v2 carry their V number and project types, defined in the [legend](README.md#levels-and-project-types).

- **F1** (must) Actions are pinned to a commit SHA, top-level `permissions` are `read` or `{}`, checkouts set `persist-credentials: false`, jobs have timeouts, PR workflows have concurrency, `pull_request_target` is never used, and an invariant test checks all of it. Reason: a compromised action or token cannot reach secrets or write access.
- **F2** (must) The workflows are ci (job "CI passed", commitlint), codeql, scorecard, labels, lint-pr (job "Validate PR title"), lint-workflows, lint-docs and release. Reason: the same names let rulesets require the same checks in every repo.
- **F3** (must) The runner is an expression with `BLACKSMITH_RUNNER`. Reason: runners switch from one repository variable.
- **F4** (must) A release is tag-driven: the tag is on `main`, "CI passed" is green for it, the notes come from the `CHANGELOG.md` section and the release fails when that section is missing or empty, tags are signed and annotated, builds carry provenance, and libraries publish through npm trusted publishing. Reason: a release cannot ship unverified or without notes.
- **F6** (V28, must, all) `ci`, `codeql` and `lint-docs` accept `workflow_dispatch`, every workflow has a concurrency group (including labels and release), and deploy jobs are guarded to `main`. Reason: any check can be re-run by hand, and runs never pile up.
- **F7** (V29, must, all) CodeQL runs in build-mode none on pull requests and on `develop` pushes, and its `analyze` check is required; Scorecard runs on `main` pushes and on `branch_protection_rule` with SARIF output; both skip private repos. Reason: code scanning gates a merge and the repo's posture is scored.
- **F8** (V30, must, all) commitlint is skipped on the `develop` to `main` promotion pull request. Reason: the promotion title is fixed by A1 and is not a commit message.
- **F9** (V31, should, all) Test reports upload with `if: failure()`, and a latest-Bun canary job runs. Reason: a failure leaves its evidence, and a Bun release breaks CI before it breaks a contributor.
- **F10** (V32, should, all) actionlint and zizmor run on trunk pushes too, and a tested workflow-rules library enforces that steps call scripts and not tools and that runner routing has reasons. Reason: a workflow rule is a test, not a review comment.
- **F11** (V33, must, all) Tests check that ruleset required checks match real job names, and promotion invariants hold between rulesets, settings and docs. Reason: a renamed job must not silently unblock a merge.
- **F12** (V34, must, site) A site build and smoke test run on pull requests that touch the site. Reason: a site breakage is found before merge.
- **F13** (V35, must, rel) A release fails before the build unless the tag is signed and annotated, the tag equals the manifest version and the `CHANGELOG.md` section exists. Reason: an unverified tag never produces artifacts.
- **F14** (V36, must, bin) A release publishes `SHA256SUMS`, smoke-runs each binary target on its native runner, writes each binary's size to the step summary, and the README has "Verify a release" and "Supported platforms". Reason: a user can verify and trust what runs on their platform.
- **F15** (V37, should, rel) A release-prep script bumps the version and moves `[Unreleased]` to a dated section with links. Reason: the changelog and the version change together.
- **F16** (V38, must, lib) `check` runs `publint --strict` and `attw`, and a size budget fails when exceeded. Reason: a broken package shape or a bloated package never publishes.

The `github-ci` Module writes this set into a generated Project, minus release: ci (jobs "check", "Commitlint" and "CI passed"), codeql, scorecard, labels (job "Sync labels"), lint-pr (job "Validate PR title"), lint-workflows (job "actionlint + zizmor") and lint-docs (job "Check markdown links"). The "Commitlint" job does nothing in a Project without a commitlint configuration, and Bun is installed at the version `package.json` pins, or the latest when it pins none. The invariant tests in `tools/workflows/` check the Module's workflow files with every F1 rule and the F3 runner expression; they skip the push branches rule, because a generated Project chooses its own trunk.

The Renovate rules live in [renovate](renovate.md).
