import { defineModule } from "@aokit/module";

export default defineModule({
  name: "wxt",
  version: "1.0.0",
  provides: [{ capability: "extension", cardinality: { max: 1 } }],
  files: [
    {
      from: "files/wxt.config.ts",
      to: "wxt.config.ts",
      target: "extension",
      ownership: "seed",
    },
    {
      from: "files/extension.tsconfig.json",
      to: "tsconfig.json",
      target: "extension",
      ownership: "seed",
    },
    {
      from: "files/entrypoints/background.ts",
      to: "entrypoints/background.ts",
      target: "extension",
      ownership: "seed",
    },
    {
      from: "files/entrypoints/popup/index.html",
      to: "entrypoints/popup/index.html",
      target: "extension",
      ownership: "seed",
    },
    {
      from: "files/entrypoints/popup/main.tsx",
      to: "entrypoints/popup/main.tsx",
      target: "extension",
      ownership: "managed",
    },
    {
      from: "files/entrypoints/popup/App.tsx",
      to: "entrypoints/popup/App.tsx",
      target: "extension",
      ownership: "seed",
    },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/wxt/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "@wxt-dev/module-react": { range: "catalog" },
      react: { range: "catalog" },
      "react-dom": { range: "catalog" },
      wxt: { range: "catalog" },
    },
    devDependencies: {
      "@types/react": { range: "catalog" },
      "@types/react-dom": { range: "catalog" },
      typescript: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## wxt\n\nWXT with React provides the extension Target.\n\nCommands:\n\n- `bun run ext:dev`: launch a browser with the extension and hot reload.\n- `bun run ext:build`: build the extension into `.output/`.\n- `bun run ext:zip`: package the extension for a store.\n\nKey files:\n\n- `wxt.config.ts`: WXT configuration and the manifest source (permissions, name).\n- `entrypoints/background.ts`: the background service worker.\n- `entrypoints/popup/`: the React popup, yours to edit.\n- `tsconfig.json`: TypeScript options for the extension Target, yours to edit.\n\nSkills:\n\n- `.claude/skills/wxt/SKILL.md`: how to add entrypoints, change the manifest and build.\n",
    },
    {
      op: "appendRegion",
      target: "root",
      file: ".gitignore",
      region: "wxt",
      content: "node_modules\n.output\n.wxt\n*.tsbuildinfo\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          "ext:dev": "bun run --cwd {{target:extension}} wxt",
          "ext:build": "bun run --cwd {{target:extension}} wxt build",
          "ext:zip": "bun run --cwd {{target:extension}} wxt zip",
        },
      },
    },
  ],
});
