import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tailwind4",
  version: "2.0.1",
  description: "Tailwind CSS 4 styling with a shared theme.",
  provides: [{ capability: "styling", cardinality: { max: 1 } }],
  requires: ["web", "ext:web.styles@^1"],
  files: [
    { from: "files/styles.css", to: "src/styles.css", target: "web", ownership: "seed" },
    {
      from: "files/postcss.config.mjs",
      to: "postcss.config.mjs",
      target: "web",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      tailwindcss: { range: "catalog" },
    },
    devDependencies: {
      "@tailwindcss/postcss": { range: "catalog" },
      postcss: { range: "catalog" },
    },
  },
  migrations: [
    {
      from: ">=1.0.0 <2.0.0",
      to: "2.0.0",
      stage: "after",
      script: "migrations/remove-tailwind-provider.after.js",
    },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## tailwind4\n\nTailwind CSS v4 styles the web Target through PostCSS.\n\nKey files:\n\n- `src/styles.css`: imports Tailwind and holds the `@theme` tokens.\n- `postcss.config.mjs`: enables `@tailwindcss/postcss`.\n",
    },
    {
      op: "addCssAtRule",
      target: "web",
      file: "src/styles.css",
      rule: "import",
      params: '"tailwindcss"',
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.styles",
      range: "^1",
      from: "./styles.css",
      sideEffect: true,
    },
  ],
  extensionPoints: [
    {
      name: "styles.theme",
      version: "1.0.0",
      target: "web",
      kind: "region",
      anchor: "theme",
      file: "src/styles.css",
    },
  ],
});
