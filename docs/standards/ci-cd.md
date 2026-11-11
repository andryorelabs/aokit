# CI and CD

GitHub Actions hygiene, the workflow set, runners and the release flow. Index: [standards](README.md). Dependency updates are in [renovate](renovate.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

Each rule is marked **must** or **should**, gives one sentence, then the reason.

- **F1** (must) Actions are pinned to a commit SHA, top-level `permissions` are `read` or `{}`, checkouts set `persist-credentials: false`, jobs have timeouts, PR workflows have concurrency, `pull_request_target` is never used, and an invariant test checks all of it. Reason: a compromised action or token cannot reach secrets or write access.
- **F2** (must) The workflows are ci (job "CI passed", commitlint), codeql, scorecard, labels, lint-pr (job "Validate PR title"), lint-workflows, lint-docs and release. Reason: the same names let rulesets require the same checks in every repo.
- **F3** (must) The runner is an expression with `BLACKSMITH_RUNNER`. Reason: runners switch from one repository variable.
- **F4** (must) A release is tag-driven: the tag is on `main`, "CI passed" is green for it, the notes come from the `CHANGELOG.md` section and the release fails when that section is missing or empty, tags are signed and annotated, builds carry provenance, and libraries publish through npm trusted publishing. Reason: a release cannot ship unverified or without notes.

The `github-ci` Module writes this set into a generated Project, minus release: ci (jobs "check", "Commitlint" and "CI passed"), codeql, scorecard, labels (job "Sync labels"), lint-pr (job "Validate PR title"), lint-workflows (job "actionlint + zizmor") and lint-docs (job "Check markdown links"). The "Commitlint" job does nothing in a Project without a commitlint configuration, and Bun is installed at the version `package.json` pins, or the latest when it pins none. The invariant tests in `tools/workflows/` check the Module's workflow files with every F1 rule and the F3 runner expression; they skip the push branches rule, because a generated Project chooses its own trunk.

The Renovate rules live in [renovate](renovate.md).
