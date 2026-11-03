import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tailwind4",
  version: "1.0.0",
  provides: [{ capability: "styling", cardinality: { max: 1 } }],
  requires: ["web", "ext:web.providers@^1", "ext:vite.plugins@^1"],
  files: [
    { from: "files/styles.css", to: "styles.css", target: "web", ownership: "seed" },
    {
      from: "files/tailwind-provider.tsx",
      to: "tailwind-provider.tsx",
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
      op: "addCssAtRule",
      target: "web",
      file: "styles.css",
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
      target: "root",
      extensionPoint: "vite.plugins",
      range: "^1",
      from: "@tailwindcss/vite",
      default: "tailwindcss",
    },
    {
      op: "addToArray",
      target: "root",
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
      file: "styles.css",
    },
  ],
});
