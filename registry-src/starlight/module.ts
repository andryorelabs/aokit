import { defineModule } from "@aokit/module";

export default defineModule({
  name: "starlight",
  version: "1.0.0",
  provides: [{ capability: "docs-site", cardinality: { max: 1 } }],
  requires: ["ext:astro.integrations@^1"],
  override: [
    {
      file: "web:src/pages/index.astro",
      reason: "the docs landing replaces the Astro starter home page",
    },
  ],
  files: [
    {
      from: "files/content.config.ts",
      to: "src/content.config.ts",
      target: "web",
      ownership: "managed",
    },
    { from: "files/index.astro", to: "src/pages/index.astro", target: "web", ownership: "seed" },
    {
      from: "files/example.mdx",
      to: "src/content/docs/guides/example.mdx",
      target: "web",
      ownership: "seed",
    },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/starlight-docs/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "@astrojs/starlight": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## starlight\n\nStarlight adds a documentation site to the Astro web Target.\n\nKey files:\n\n- `src/content/docs/`: the documentation pages, yours to edit.\n- `src/content.config.ts`: the `docs` content collection.\n- `src/pages/index.astro`: the docs landing page, yours to edit.\n- `astro.config.ts`: the Starlight integration options (title, sidebar).\n- `.claude/skills/starlight-docs/SKILL.md`: how to add and organize pages.\n",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "astro.integrations",
      range: "^1",
      from: "@astrojs/starlight",
      default: "starlight",
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "astro.integrations",
      range: "^1",
      element: 'starlight({ title: "Docs" })',
    },
  ],
});
