import { defineModule } from "@aokit/module";

export default defineModule({
  name: "commitlint",
  version: "1.0.0",
  provides: [{ capability: "commit-lint", cardinality: { max: 1 } }],
  requires: ["git-hooks"],
  files: [
    { from: "files/commit-msg", to: ".husky/commit-msg", target: "root", ownership: "managed" },
    {
      from: "files/commitlint.config.mjs",
      to: "commitlint.config.mjs",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      "@commitlint/cli": { range: "catalog" },
      "@commitlint/config-conventional": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## commitlint\n\nCommitlint rejects commit messages that are not Conventional Commits.\n\nKey files:\n\n- `.husky/commit-msg`: runs Commitlint on every commit.\n- `commitlint.config.mjs`: the rule set, at the Project root.\n",
    },
  ],
});
