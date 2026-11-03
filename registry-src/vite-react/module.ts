import { defineModule } from "@aokit/module";

export default defineModule({
  name: "vite-react",
  version: "1.0.0",
  provides: [
    { capability: "web", cardinality: { max: 1 } },
    { capability: "web:spa", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/index.html", to: "index.html", target: "web", ownership: "managed" },
    { from: "files/vite.config.ts", to: "vite.config.ts", target: "web", ownership: "managed" },
    { from: "files/tsconfig.json", to: "tsconfig.json", target: "web", ownership: "seed" },
    { from: "files/main.tsx", to: "src/main.tsx", target: "web", ownership: "managed" },
    { from: "files/providers.tsx", to: "src/providers.tsx", target: "web", ownership: "managed" },
    { from: "files/routes.tsx", to: "src/routes.tsx", target: "web", ownership: "managed" },
  ],
  deps: {
    dependencies: {
      react: { range: "catalog" },
      "react-dom": { range: "catalog" },
    },
    devDependencies: {
      "@types/react": { range: "catalog" },
      "@types/react-dom": { range: "catalog" },
      "@vitejs/plugin-react": { range: "catalog" },
      typescript: { range: "catalog" },
      vite: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          dev: "bun run --cwd {{target:web}} vite",
          build: "bun run --cwd {{target:web}} vite build",
          preview: "bun run --cwd {{target:web}} vite preview",
        },
      },
    },
  ],
  extensionPoints: [
    {
      name: "vite.plugins",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "plugins",
      file: "vite.config.ts",
    },
    {
      name: "web.providers",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "providers",
      file: "src/providers.tsx",
    },
    {
      name: "web.routes",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "routes",
      file: "src/routes.tsx",
    },
  ],
});
