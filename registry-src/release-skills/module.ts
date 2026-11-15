import { defineModule } from "@aokit/module";

export default defineModule({
  name: "release-skills",
  version: "1.0.0",
  description: "The cut-release Claude skill: how to cut and verify a release.",
  provides: [{ capability: "docs:release", cardinality: { max: 1 } }],
  files: [
    {
      from: "files/cut-release.md",
      to: ".claude/skills/cut-release/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## release-skills\n\nThe release procedure is a project skill.\n\nSkills:\n\n- `.claude/skills/cut-release/SKILL.md`: how to cut and verify a release.\n",
    },
  ],
});
