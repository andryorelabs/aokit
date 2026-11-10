import { defineModule } from "@aokit/module";

export default defineModule({
  name: "husky",
  version: "1.0.1",
  description: "Git hooks managed with Husky.",
  provides: [{ capability: "git-hooks", cardinality: { max: 1 } }],
  deps: {
    devDependencies: {
      husky: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## husky\n\nHusky runs Git hooks for this Project.\n\nKey files:\n\n- `.husky/`: one file per hook, written by the Modules that own the hook.\n- `package.json`: the `prepare` script installs the hooks after `bun install`.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { prepare: "husky" } },
    },
  ],
});
