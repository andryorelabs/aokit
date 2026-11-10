import { defineModule } from "@aokit/module";

export default defineModule({
  name: "nuqs-next",
  version: "1.0.1",
  description: "Type-safe URL query state for Next.js with nuqs.",
  provides: [{ capability: "url-state", cardinality: { max: 1 } }],
  requires: ["web:app-router", "ext:web.providers@^1"],
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
        "\n## nuqs-next\n\nnuqs keeps state in the URL query string for the Next App Router.\n\nKey files:\n\n- `src/providers.tsx`: registers the nuqs adapter (`nuqs/adapters/next/app`) through `web.providers`; use `useQueryState` from `nuqs` in client components.\n",
    },
    {
      op: "addImport",
      target: "web",
      extensionPoint: "web.providers",
      range: "^1",
      from: "nuqs/adapters/next/app",
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
