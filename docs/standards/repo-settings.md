# Repo settings

GitHub settings, rulesets, security features, metadata, labels and URLs for every AndryOre repository. Index: [standards](README.md). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

Each rule is marked **must** or **should**, gives one sentence, then the reason. Settings live as code, so drift is visible.

## Merging

- **A1** (must) Work lands on `develop` by squash merge so `develop` is linear, a promotion is a pull request from `develop` to `main` merged with a merge commit and titled `chore: 🔀 promote develop to main`, there is no sync step, `main` is the default branch and the only branch that deploys and carries tags, and squash and merge commits are on at repo level while rebase is off. Reason: one commit per change keeps `develop` linear and readable, and every repository follows one branch model.
- **A2** (must) Delete branch on merge, auto-merge and update branch are on, and `pr.autoMerge` is explicit in `emet.config.json`. Reason: stale branches vanish and the emet configuration never guesses.
- **A3** (must) The squash commit title is `PR_TITLE` and the message is `PR_BODY`, and the merge commit settings sit next to them: `allow_merge_commit: true`, `merge_commit_title: PR_TITLE`, `merge_commit_message: PR_BODY`. Reason: the validated pull request title becomes the commit subject for both merge methods.

## Rulesets

- **A4** (must) Rulesets live as code in `.github/rulesets/{main,develop,tags}.json`, live settings equal the JSON, a test checks that every required check name is a job name, and a `repo-settings:check` script diffs live settings against the files. Reason: a ruleset edited in the web UI drifts silently.
  - `develop`: no deletion, no force push, linear history, pull request required, squash only, thread resolution, required checks "CI passed" and "Validate PR title", no bypass; strict required checks are a should.
  - `main`: no deletion, no force push, pull request required, merge commit only, thread resolution, required checks "CI passed" and "Validate PR title", no bypass, and neither linear history nor the strict policy, because a promotion merge commit is never on `develop`.
  - Tags `refs/tags/v*`: no deletion, no update, no force push.
  - The repo's own session applies settings and records the step in `docs/development.md`; the script only reads.
- **A5** (should) `develop` and `main` require signed commits, and "Check markdown links" is a required check where `lint-docs` is its own workflow. Reason: signatures prove authorship and a broken link must block a merge.

## Security

- **A6** (must) Secret scanning, push protection, Dependabot alerts, Dependabot security updates and private vulnerability reporting are on, and Renovate is the version updater. Reason: leaks and known-vulnerable dependencies are caught before release without a second updater.

## Metadata

- **A7** (must) The description comes from `docs/brand/copy.md`, the homepage is the product site or else the docs entry point, there are at least five topics, and a custom social preview is set. Reason: the repo page is the first thing a reader sees.
- **A8** (must) Wiki, projects and discussions are off, and no file links to discussions. Reason: docs and issues are the only places a reader should look.

## Labels

- **A9** (must) `.github/labels.yml` is the only label source, is synced to the repo, contains every label Renovate and the issue forms reference, and uses Type, Status, Priority and Area; repos tracked on GitHub add `status:*` and triage labels. Reason: a label used but not declared silently fails to apply.

## URLs

- **A10** (must) URLs use `github.com/andryorelabs/<repo>`, and a package homepage equals the GitHub homepage. Reason: moved or mixed URLs break links and package pages.
