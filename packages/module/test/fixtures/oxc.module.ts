import { defineModule } from "@aokit/module";

export default defineModule({
  name: "oxc",
  version: "1.0.0",
  description: "Oxlint linting and Oxfmt formatting.",
  provides: ["lint", { capability: "format", cardinality: { max: 1 } }],
  files: [
    { from: "files/oxlintrc.json", to: ".oxlintrc.json", target: "config", ownership: "managed" },
  ],
  deps: {
    devDependencies: {
      oxlint: { range: "catalog", pinGroup: "oxc" },
      oxfmt: { range: "catalog", pinGroup: "oxc" },
    },
  },
  ops: [
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { lint: "oxlint", format: "oxfmt" } },
    },
  ],
  extensionPoints: [
    {
      name: "lint.ignores",
      version: "1.0.0",
      target: "config",
      kind: "array",
      anchor: "ignorePatterns",
    },
  ],
});
