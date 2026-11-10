import { defineModule } from "@aokit/module";

export default defineModule({
  name: "axe",
  version: "1.0.1",
  description: "Accessibility checks with axe-core for your Playwright end-to-end tests.",
  provides: [{ capability: "a11y-test", cardinality: { max: 1 } }],
  requires: ["e2e"],
  files: [{ from: "files/a11y.e2e.ts", to: "e2e/a11y.e2e.ts", target: "root", ownership: "seed" }],
  deps: {
    devDependencies: {
      "@axe-core/playwright": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## axe\n\nAxe checks pages for accessibility violations inside the Playwright suite.\n\nKey files:\n\n- `e2e/a11y.e2e.ts`: a starter accessibility spec run by `bun run test:e2e`, yours to extend.\n",
    },
  ],
});
