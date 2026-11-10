import { defineModule } from "@aokit/module";

export default defineModule({
  name: "trigger-dev",
  version: "1.0.1",
  description: "Background jobs and scheduled tasks with Trigger.dev.",
  provides: [{ capability: "jobs", cardinality: { max: 1 } }],
  files: [
    {
      from: "files/trigger.config.ts",
      to: "trigger.config.ts",
      target: "jobs",
      ownership: "managed",
    },
    {
      from: "files/src/trigger/hello-world.ts",
      to: "src/trigger/hello-world.ts",
      target: "jobs",
      ownership: "seed",
    },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/trigger-dev/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: { "@trigger.dev/sdk": { range: "catalog" } },
    devDependencies: { "trigger.dev": { range: "catalog" } },
  },
  env: [{ key: "TRIGGER_SECRET_KEY", scope: "jobs", schema: "z.string().min(1)", example: "" }],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## trigger-dev\n\nTrigger.dev runs background jobs on the jobs Target.\n\nCommands:\n\n- `bun run jobs:dev`: connect a local worker.\n- `bun run jobs:deploy`: deploy the tasks.\n\nKey files:\n\n- `trigger.config.ts`: the project config; set `TRIGGER_PROJECT_REF` in `.env`.\n- `src/trigger/hello-world.ts`: a sample task, yours to edit.\n\nSet `TRIGGER_SECRET_KEY` in `.env`; aokit never generates secrets.\n\nSkills:\n\n- `.claude/skills/trigger-dev/SKILL.md`: how to add and run tasks.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          "jobs:dev": "bun run --cwd {{target:jobs}} trigger dev",
          "jobs:deploy": "bun run --cwd {{target:jobs}} trigger deploy",
        },
      },
    },
  ],
});
