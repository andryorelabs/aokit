import { defineModule } from "@aokit/module";

export default defineModule({
  name: "knip",
  version: "1.1.0",
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
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## knip\n\nKnip finds unused files, exports and dependencies.\n\nCommands:\n\n- `bun run knip`: report unused code.\n\nKey files:\n\n- `knip.json`: Knip configuration, at the Project root.\n",
    },
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
