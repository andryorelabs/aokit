import { defineModule } from "@aokit/module";

export default defineModule({
  name: "turborepo",
  version: "1.0.0",
  provides: [{ capability: "task-runner", cardinality: { max: 1 } }],
  files: [{ from: "files/turbo.json", to: "turbo.json", target: "root", ownership: "managed" }],
  deps: {
    devDependencies: { turbo: { range: "catalog" } },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## turborepo\n\nTurborepo runs and caches package tasks, in a single package or a workspace.\n\nCommands:\n\n- `bun run task <name>`: run a task through Turborepo, for example `bun run task build`.\n\nKey files:\n\n- `turbo.json`: the task graph, outputs and caching rules.\n",
    },
    {
      op: "appendRegion",
      target: "root",
      file: ".gitignore",
      region: "turborepo",
      content: ".turbo\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { packageManager: "bun@1.4.4", scripts: { task: "turbo run" } },
    },
  ],
});
