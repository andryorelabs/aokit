import { defineModule } from "@aokit/module";

export default defineModule({
  name: "astro",
  version: "1.1.0",
  description: "Astro web app with React islands and static output.",
  provides: [
    { capability: "web", cardinality: { max: 1 } },
    { capability: "web:react", cardinality: { max: 1 } },
    { capability: "web:static", cardinality: { max: 1 } },
  ],
  files: [
    {
      from: "files/astro.config.ts",
      to: "astro.config.ts",
      target: "web",
      ownership: "managed",
    },
    { from: "files/tsconfig.json", to: "tsconfig.json", target: "web", ownership: "seed" },
    { from: "files/styles.ts", to: "src/styles.ts", target: "web", ownership: "managed" },
    {
      from: "files/Layout.astro",
      to: "src/layouts/Layout.astro",
      target: "web",
      ownership: "managed",
    },
    { from: "files/index.astro", to: "src/pages/index.astro", target: "web", ownership: "seed" },
    {
      from: "files/Counter.tsx",
      to: "src/components/Counter.tsx",
      target: "web",
      ownership: "seed",
    },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/astro-page/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "@astrojs/react": { range: "catalog" },
      astro: { range: "catalog" },
      react: { range: "catalog" },
      "react-dom": { range: "catalog" },
    },
    devDependencies: {
      "@types/react": { range: "catalog" },
      "@types/react-dom": { range: "catalog" },
      typescript: { range: "catalog" },
      vite: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## astro\n\nAstro with React islands provides the web Target as a static site.\n\nKey files:\n\n- `astro.config.ts`: Astro configuration; other Modules register integrations and Vite plugins here.\n- `src/styles.ts`: the stylesheets other Modules register, imported by `Layout.astro`.\n- `src/layouts/Layout.astro`: the page shell every page wraps itself in.\n- `src/pages/index.astro`: the home page, yours to edit.\n- `src/components/Counter.tsx`: a React island, yours to edit.\n- `.claude/skills/astro-page/SKILL.md`: how to add pages, layouts and islands.\n",
    },
    {
      op: "appendRegion",
      target: "root",
      file: ".gitignore",
      region: "astro",
      content: "node_modules\ndist\n.astro\n*.tsbuildinfo\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          dev: "bun run --cwd {{target:web}} astro dev",
          build: "bun run --cwd {{target:web}} astro build",
          preview: "bun run --cwd {{target:web}} astro preview",
          typecheck: "bun run --cwd {{target:web}} tsc --noEmit",
        },
      },
    },
  ],
  extensionPoints: [
    {
      name: "astro.integrations",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "integrations",
      file: "astro.config.ts",
    },
    {
      name: "vite.plugins",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "plugins",
      file: "astro.config.ts",
    },
    {
      name: "web.styles",
      version: "1.0.0",
      target: "web",
      kind: "import-list",
      anchor: "stylesheets",
      file: "src/styles.ts",
    },
  ],
});
