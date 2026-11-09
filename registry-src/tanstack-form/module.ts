import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tanstack-form",
  version: "1.0.0",
  provides: [{ capability: "forms", cardinality: { max: 1 } }],
  requires: ["web:react"],
  files: [
    {
      from: "files/example-form.ts.txt",
      to: "src/lib/example-form.ts",
      target: "web",
      ownership: "seed",
    },
  ],
  deps: {
    dependencies: {
      "@tanstack/react-form": { range: "catalog" },
      zod: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## tanstack-form\n\nTanStack Form manages form state, validated with Zod schemas.\n\nKey files:\n\n- `src/lib/example-form.ts`: a form hook validated by a Zod schema, yours to extend.\n",
    },
  ],
});
