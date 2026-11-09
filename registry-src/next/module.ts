import { defineModule } from "@aokit/module";

export default defineModule({
  name: "next",
  version: "1.0.0",
  provides: [
    { capability: "web", cardinality: { max: 1 } },
    { capability: "web:ssr", cardinality: { max: 1 } },
    { capability: "web:react", cardinality: { max: 1 } },
    { capability: "web:app-router", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/next.config.ts", to: "next.config.ts", target: "web", ownership: "managed" },
    { from: "files/tsconfig.json", to: "tsconfig.json", target: "web", ownership: "seed" },
    { from: "files/app/layout.tsx", to: "src/app/layout.tsx", target: "web", ownership: "managed" },
    { from: "files/app/page.tsx", to: "src/app/page.tsx", target: "web", ownership: "seed" },
    { from: "files/providers.tsx", to: "src/providers.tsx", target: "web", ownership: "managed" },
    { from: "files/styles.ts", to: "src/styles.ts", target: "web", ownership: "managed" },
    { from: "files/css.d.ts", to: "src/css.d.ts", target: "web", ownership: "seed" },
    { from: "files/proxy.ts", to: "src/proxy.ts", target: "web", ownership: "managed" },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/next/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      next: { range: "catalog" },
      react: { range: "catalog" },
      "react-dom": { range: "catalog" },
    },
    devDependencies: {
      "@types/node": { range: "catalog" },
      "@types/react": { range: "catalog" },
      "@types/react-dom": { range: "catalog" },
      "babel-plugin-react-compiler": { range: "catalog" },
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
        "\n## next\n\nNext 16 with the App Router provides the web Target; React Compiler is on.\n\nKey files:\n\n- `next.config.ts`: Next configuration; other Modules add options and plugins through its extension points.\n- `src/app/layout.tsx`: the root layout; it imports `src/styles.ts` and wraps pages in the providers.\n- `src/app/page.tsx`: the home page, yours to edit.\n- `src/providers.tsx`: the client providers; register new ones through `web.providers`.\n- `src/styles.ts`: the stylesheets other Modules register.\n- `src/proxy.ts`: the request proxy (Next 16 replacement for middleware); one Module owns it.\n- `tsconfig.json`: TypeScript options for the web Target, yours to edit.\n\nSkills:\n\n- `.claude/skills/next/SKILL.md`: how to work on the Next.js App Router Target.\n",
    },
    {
      op: "appendRegion",
      target: "root",
      file: ".gitignore",
      region: "next",
      content: "node_modules\n.next\nout\nnext-env.d.ts\n*.tsbuildinfo\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          dev: "bun run --cwd {{target:web}} next dev",
          build: "bun run --cwd {{target:web}} next build",
          start: "bun run --cwd {{target:web}} next start",
        },
      },
    },
  ],
  extensionPoints: [
    {
      name: "web.providers",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "providers",
      file: "src/providers.tsx",
    },
    {
      name: "web.styles",
      version: "1.0.0",
      target: "web",
      kind: "import-list",
      anchor: "root",
      file: "src/styles.ts",
    },
    {
      name: "next.config",
      version: "1.0.0",
      target: "web",
      kind: "object",
      anchor: "nextConfig",
      file: "next.config.ts",
    },
    {
      name: "next.plugins",
      version: "1.0.0",
      target: "web",
      kind: "array",
      anchor: "plugins",
      file: "next.config.ts",
    },
  ],
});
