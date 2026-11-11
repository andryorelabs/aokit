# Community and README

Root files, `.github` files, issue forms, manifests and the README shape. Index: [standards](README.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

Each rule is marked **must** or **should**, gives one sentence, then the reason.

## Files

- **B1** (must) The root holds README, LICENSE, CHANGELOG (Keep a Changelog, with `[Unreleased]` and a section per tag), CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, GLOSSARY, `.editorconfig` and `.git-blame-ignore-revs`. Reason: contributors and tools look for these at the root.
- **B2** (must) `.github` holds SECURITY, SUPPORT, CODEOWNERS and a PR template with Description, Related issue, Type of change, Breaking change and Checklist, stating the title format `type: <gitmoji> lowercase subject`. Reason: reports and reviews arrive with the same information.
- **B3** (must) Issue forms are `1-bug-report.yml`, `2-feature-request.yml`, `3-enhancement-request.yml` and `4-documentation-bug.yml`, each applying its labels, with a `config.yml` that turns blank issues off; a site may drop the third. Reason: structured reports triage faster.
- **B4** (must) Every manifest (packages and plugin manifests) has description, license, author `Andry Orellana <hello@andryore.dev>`, homepage, repository and bugs. Reason: registries show these fields as the project's identity.
- **B5** (should) A repo has ROADMAP and PRODUCT; `llms.txt` is a must for a CLI and for a plugin. Reason: agents and users read the product intent from files, not guesses.
- **B6** (must) `.gitattributes` exists, and `FUNDING.yml` exists only in andryore-web. Reason: line endings stay stable, and funding is one site's decision.
- **B7** (must) `.node-version` exists where a script runs under Node. Reason: Node scripts run on the same version locally and in CI.

## README

- **C1** (must) The README starts with a top-level heading, then a centered light and dark cover, a bold slogan, badges and a links line. Reason: every AndryOre project looks the same on first sight.
- **C2** (must) Badges are CI, release or package version, license and OpenSSF Scorecard, then the ecosystem ones, with no placeholders. Reason: a placeholder badge is a broken promise.
- **C3** (must) Sections are what it is, Install or Quickstart, Usage or How it works, Documentation, Contributing and License; the last line is `Built by [AndryOre](https://andryore.dev)`, then any non-affiliation line. Reason: readers find the same things in the same order, and the credit stays last.
- **C4** (must) The slogan and descriptions are copied from `docs/brand/copy.md`, and a drift test fails when they differ. Reason: one source of copy cannot disagree with itself.
