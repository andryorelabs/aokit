import { defineModule } from "@aokit/module";

export default defineModule({
  name: "oxc",
  version: "1.2.0",
  provides: [
    { capability: "lint", cardinality: { max: 1 } },
    { capability: "format", cardinality: { max: 1 } },
  ],
  conflicts: ["eslint-prettier"],
  files: [
    { from: "files/oxlintrc.json", to: ".oxlintrc.json", target: "config", ownership: "managed" },
    { from: "files/oxfmtrc.json", to: ".oxfmtrc.json", target: "root", ownership: "managed" },
  ],
  deps: {
    devDependencies: {
      oxlint: { range: "catalog", pinGroup: "oxc" },
      oxfmt: { range: "catalog", pinGroup: "oxc" },
      "oxlint-tsgolint": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## oxc\n\nOxc provides linting (Oxlint) and formatting (Oxfmt) for this Project.\n\nCommands:\n\n- `bun run lint`: run Oxlint with the shared config and type-aware rules (powered by `oxlint-tsgolint`).\n- `bun run format`: format the Project with Oxfmt.\n\nKey files:\n\n- `.oxlintrc.json`: lint rules and ignore patterns, in the config Target.\n- `.oxfmtrc.json`: formatter options, at the Project root.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          lint: 'oxlint --type-aware --ignore-pattern "**/node_modules/**" -c {{target:config}}/.oxlintrc.json',
          format: "oxfmt",
        },
      },
    },
  ],
  extensionPoints: [
    {
      name: "lint.ignores",
      version: "1.0.0",
      target: "config",
      kind: "json",
      anchor: "/ignorePatterns",
      file: ".oxlintrc.json",
    },
  ],
});
