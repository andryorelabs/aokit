import { defineModule } from "@aokit/module";

export default defineModule({
  name: "vite-react",
  version: "1.0.0",
  provides: [
    { capability: "web", cardinality: { max: 1 } },
    { capability: "web:spa", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/index.html", to: "index.html", target: "root", ownership: "managed" },
    { from: "files/vite.config.ts", to: "vite.config.ts", target: "root", ownership: "managed" },
    { from: "files/tsconfig.json", to: "tsconfig.json", target: "root", ownership: "seed" },
    { from: "files/main.tsx", to: "main.tsx", target: "web", ownership: "managed" },
    { from: "files/providers.tsx", to: "providers.tsx", target: "web", ownership: "managed" },
    { from: "files/routes.tsx", to: "routes.tsx", target: "web", ownership: "managed" },
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
      value: { scripts: { dev: "vite", build: "vite build", preview: "vite preview" } },
    },
  ],
  extensionPoints: [
    {
      name: "web.providers",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "providers",
    },
    {
      name: "web.routes",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "routes",
    },
  ],
});
