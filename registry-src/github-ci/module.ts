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
  version: "1.0.0",
  provides: [{ capability: "ci", cardinality: { max: 1 } }],
  files: [
    managed("workflows/ci.yml", ".github/workflows/ci.yml"),
    managed("workflows/codeql.yml", ".github/workflows/codeql.yml"),
    managed("workflows/scorecard.yml", ".github/workflows/scorecard.yml"),
    managed("workflows/lint-pr.yml", ".github/workflows/lint-pr.yml"),
    managed("workflows/lint-workflows.yml", ".github/workflows/lint-workflows.yml"),
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
        "\n## github-ci\n\nGitHub Actions workflows with every action pinned by commit SHA. Package scripts run with `--if-present`, so the workflows work for any selection.\n\nKey files:\n\n- `.github/workflows/ci.yml`: typecheck, lint, format check and test.\n- `.github/workflows/codeql.yml`, `scorecard.yml`: security analysis on public repositories.\n- `.github/workflows/lint-pr.yml`: conventional PR titles.\n- `.github/workflows/lint-workflows.yml`: actionlint and zizmor.\n- `.github/workflows/labels.yml` and `.github/labels.yml`: the label set, synced on `main`.\n- `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/`: templates you own.\n",
    },
  ],
});
