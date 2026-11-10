import { defineModule } from "@aokit/module";

export default defineModule({
  name: "adr-docs",
  version: "1.0.1",
  description: "Architecture Decision Records: a docs/adr folder with a template and an index.",
  provides: [{ capability: "docs:adr", cardinality: { max: 1 } }],
  files: [
    { from: "files/adr/README.md", to: "docs/adr/README.md", target: "root", ownership: "seed" },
    {
      from: "files/adr/template.md",
      to: "docs/adr/0000-template.md",
      target: "root",
      ownership: "seed",
    },
    { from: "files/GLOSSARY.md", to: "GLOSSARY.md", target: "root", ownership: "seed" },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/adr/SKILL.md",
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
        "\n## adr-docs\n\nArchitecture decisions live in `docs/adr/`, and project terms in `GLOSSARY.md`.\n\nKey files:\n\n- `docs/adr/README.md`: the ADR index; add a row for every new ADR.\n- `docs/adr/0000-template.md`: copy it as `NNNN-kebab-title.md`.\n- `GLOSSARY.md`: the project vocabulary; use these terms in code and docs.\n- `.claude/skills/adr/SKILL.md`: how to write an ADR.\n",
    },
  ],
});
