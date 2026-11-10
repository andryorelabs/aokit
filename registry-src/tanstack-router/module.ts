import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tanstack-router",
  version: "1.0.1",
  description: "File-based type-safe routing with TanStack Router.",
  provides: [{ capability: "routing", cardinality: { max: 1 } }],
  requires: ["web:spa", "ext:vite.plugins@^1"],
  override: [
    {
      file: "web:src/router.tsx",
      reason: "the file-based route tree replaces the vite-react route table",
    },
  ],
  files: [
    { from: "files/router.tsx.txt", to: "src/router.tsx", target: "web", ownership: "managed" },
    { from: "files/root.tsx.txt", to: "src/routes/__root.tsx", target: "web", ownership: "seed" },
    { from: "files/index.tsx.txt", to: "src/routes/index.tsx", target: "web", ownership: "seed" },
    {
      from: "files/routeTree.gen.ts.txt",
      to: "src/routeTree.gen.ts",
      target: "web",
      ownership: "seed",
    },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/tanstack-router/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "@tanstack/react-router": { range: "catalog" },
    },
    devDependencies: {
      "@tanstack/router-plugin": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## tanstack-router\n\nTanStack Router adds file-based routing to the web Target.\n\nKey files:\n\n- `src/routes/`: the route files, yours to edit; a file is a route.\n- `src/routeTree.gen.ts`: the generated route tree, never edited by hand.\n- `src/router.tsx`: creates the router; it overrides the vite-react route table.\n- `vite.config.ts`: registers the router plugin that generates the route tree.\n- `.claude/skills/tanstack-router/SKILL.md`: how to add and nest routes.\n\nBecause `src/router.tsx` is overridden, `web.routes` contributors no longer apply; none exist today, so add routes as files in `src/routes/`.\n",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "vite.plugins",
      range: "^1",
      from: "@tanstack/router-plugin/vite",
      named: ["tanstackRouter"],
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "vite.plugins",
      range: "^1",
      element: 'tanstackRouter({ target: "react", autoCodeSplitting: true })',
    },
  ],
});
