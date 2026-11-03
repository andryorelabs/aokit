import { defineModule } from "@aokit/module";

export default defineModule({
  name: "oxc",
  version: "1.0.0",
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
    },
  },
  ops: [
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { lint: "oxlint -c {{target:config}}/.oxlintrc.json", format: "oxfmt" } },
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
