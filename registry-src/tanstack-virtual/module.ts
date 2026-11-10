import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tanstack-virtual",
  version: "1.0.1",
  description: "List and grid virtualization with TanStack Virtual.",
  provides: [{ capability: "virtualization", cardinality: { max: 1 } }],
  requires: ["web:react"],
  files: [
    {
      from: "files/virtualized-list.ts",
      to: "src/lib/virtualized-list.ts",
      target: "web",
      ownership: "seed",
    },
  ],
  deps: {
    dependencies: {
      "@tanstack/react-virtual": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## tanstack-virtual\n\nTanStack Virtual renders long lists by mounting only the visible rows.\n\nKey files:\n\n- `src/lib/virtualized-list.ts`: a `useVirtualizer` wrapper for a scrollable list.\n",
    },
  ],
});
