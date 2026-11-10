import { defineModule } from "@aokit/module";

export default defineModule({
  name: "nuqs-vite",
  version: "1.0.1",
  description: "Type-safe URL query state for Vite and React with nuqs.",
  provides: [{ capability: "url-state", cardinality: { max: 1 } }],
  requires: ["web:spa", "ext:web.providers@^1"],
  deps: {
    dependencies: { nuqs: { range: "catalog" } },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## nuqs-vite\n\nnuqs keeps state in the URL query string for the React SPA.\n\nKey files:\n\n- `src/providers.tsx`: registers the nuqs adapter (`nuqs/adapters/react`) through `web.providers`; use `useQueryState` from `nuqs` in components.\n",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      from: "nuqs/adapters/react",
      named: ["NuqsAdapter"],
    },
    {
      op: "addToArray",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      element: "NuqsAdapter",
    },
  ],
});
