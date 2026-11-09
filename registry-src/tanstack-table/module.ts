import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tanstack-table",
  version: "1.0.0",
  provides: [{ capability: "data-table", cardinality: { max: 1 } }],
  requires: ["web:react"],
  files: [
    {
      from: "files/example-table.tsx",
      to: "src/components/example-table.tsx",
      target: "web",
      ownership: "seed",
    },
  ],
  deps: {
    dependencies: {
      "@tanstack/react-table": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## tanstack-table\n\nTanStack Table is the headless data table engine.\n\nKey files:\n\n- `src/components/example-table.tsx`: a minimal table built with `useTable`, yours to extend.\n",
    },
  ],
});
