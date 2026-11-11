import { defineModule } from "@aokit/module";

const managed = (from: string, to: string) => ({
  from: `files/${from}`,
  to,
  target: "root" as const,
  ownership: "managed" as const,
});

const seed = (from: string, to: string) => ({
  from: `files/${from}`,
  to,
  target: "root" as const,
  ownership: "seed" as const,
});

export default defineModule({
  name: "github-ci",
  version: "1.1.0",
  description:
    "GitHub Actions workflows for CI, commit and PR title linting, markdown link checks, security analysis and labels.",
  provides: [{ capability: "ci", cardinality: { max: 1 } }],
  files: [
    managed("workflows/ci.yml", ".github/workflows/ci.yml"),
    managed("workflows/codeql.yml", ".github/workflows/codeql.yml"),
    managed("workflows/scorecard.yml", ".github/workflows/scorecard.yml"),
    managed("workflows/lint-pr.yml", ".github/workflows/lint-pr.yml"),
    managed("workflows/lint-workflows.yml", ".github/workflows/lint-workflows.yml"),
    managed("workflows/lint-docs.yml", ".github/workflows/lint-docs.yml"),
    managed("workflows/labels.yml", ".github/workflows/labels.yml"),
    seed("labels.yml", ".github/labels.yml"),
    seed("pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md"),
    seed("issue-config.yml", ".github/ISSUE_TEMPLATE/config.yml"),
    seed("bug_report.yml", ".github/ISSUE_TEMPLATE/bug_report.yml"),
    seed("feature_request.yml", ".github/ISSUE_TEMPLATE/feature_request.yml"),
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        '\n## github-ci\n\nGitHub Actions workflows with every action pinned by commit SHA. Package scripts run with `--if-present` and the commit lint job skips its work without a commitlint configuration, so the workflows work for any selection. Jobs on the pull request path run on the `BLACKSMITH_RUNNER` repository variable when it is set and on `ubuntu-latest` otherwise. A superseded run is cancelled only on a pull request.\n\nKey files:\n\n- `.github/workflows/ci.yml`: job "check" runs typecheck, lint, format check and test, each only when the Project has that script; job "Commitlint" lints the commits of a pull request when the Project has a commitlint configuration; job "CI passed" fails when either one fails or is cancelled.\n- `.github/workflows/codeql.yml`, `scorecard.yml`: security analysis on public repositories.\n- `.github/workflows/lint-pr.yml`: job "Validate PR title", conventional PR titles.\n- `.github/workflows/lint-workflows.yml`: job "actionlint + zizmor".\n- `.github/workflows/lint-docs.yml`: job "Check markdown links", lychee over every markdown file, offline, with heading anchors.\n- `.github/workflows/labels.yml` and `.github/labels.yml`: job "Sync labels", the label set, synced on `main`.\n- `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/`: templates you own.\n',
    },
  ],
});
