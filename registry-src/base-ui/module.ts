import { defineModule } from "@aokit/module";

export default defineModule({
  name: "base-ui",
  version: "1.0.1",
  description: "Base UI unstyled, accessible React primitives for building your own components.",
  provides: [{ capability: "ui:primitives", cardinality: { max: 1 } }],
  requires: ["web:react"],
  files: [
    {
      from: "files/button.tsx",
      to: "src/components/ui/button.tsx",
      target: "web",
      ownership: "seed",
    },
  ],
  deps: {
    dependencies: {
      "@base-ui/react": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## base-ui\n\nBase UI is the unstyled primitives provider for the web Target.\n\nKey files:\n\n- `src/components/ui/button.tsx`: a Base UI button wrapper, yours to style and extend.\n",
    },
  ],
});
