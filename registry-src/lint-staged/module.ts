import { defineModule } from "@aokit/module";

export default defineModule({
  name: "lint-staged",
  version: "1.0.0",
  provides: [{ capability: "staged-checks", cardinality: { max: 1 } }],
  requires: ["git-hooks", "lint", "format"],
  files: [
    { from: "files/pre-commit", to: ".husky/pre-commit", target: "root", ownership: "managed" },
    {
      from: "files/lintstagedrc.json",
      to: ".lintstagedrc.json",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      "lint-staged": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## lint-staged\n\nLint-staged formats and lints only the staged files before each commit.\n\nKey files:\n\n- `.husky/pre-commit`: runs Lint-staged.\n- `.lintstagedrc.json`: which command runs on which files, at the Project root.\n",
    },
  ],
});
