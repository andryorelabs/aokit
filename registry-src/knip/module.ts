import { defineModule } from "@aokit/module";

export default defineModule({
  name: "knip",
  version: "1.0.0",
  provides: [{ capability: "unused-code", cardinality: { max: 1 } }],
  requires: ["ext:lint.ignores@^1"],
  files: [{ from: "files/knip.json", to: "knip.json", target: "root", ownership: "managed" }],
  deps: {
    devDependencies: {
      knip: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { knip: "knip" } },
    },
    {
      op: "mergeJson",
      extensionPoint: "lint.ignores",
      range: "^1",
      value: ["knip-report/**"],
    },
  ],
});
