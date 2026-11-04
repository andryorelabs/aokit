import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tailwind4",
  version: "1.1.0",
  provides: [{ capability: "styling", cardinality: { max: 1 } }],
  requires: ["web", "ext:web.providers@^1", "ext:vite.plugins@^1"],
  files: [
    { from: "files/styles.css", to: "src/styles.css", target: "web", ownership: "seed" },
    {
      from: "files/tailwind-provider.tsx",
      to: "src/tailwind-provider.tsx",
      target: "web",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      tailwindcss: { range: "catalog" },
    },
    devDependencies: {
      "@tailwindcss/vite": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## tailwind4\n\nTailwind CSS v4 styles the web Target through the Vite plugin.\n\nKey files:\n\n- `src/styles.css`: imports Tailwind and holds the `@theme` tokens.\n- `src/tailwind-provider.tsx`: loads the stylesheet for the app.\n",
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
      extensionPoint: "web.providers",
      range: "^1",
      from: "./tailwind-provider",
      named: ["TailwindProvider"],
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      element: "TailwindProvider",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "vite.plugins",
      range: "^1",
      from: "@tailwindcss/vite",
      default: "tailwindcss",
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "vite.plugins",
      range: "^1",
      element: "tailwindcss()",
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
