import { defineModule } from "@aokit/module";

export default defineModule({
  name: "playwright",
  version: "1.0.0",
  provides: [{ capability: "e2e", cardinality: { max: 1 } }],
  requires: ["web"],
  files: [
    {
      from: "files/playwright.config.ts",
      to: "playwright.config.ts",
      target: "root",
      ownership: "seed",
    },
    { from: "files/smoke.e2e.ts", to: "e2e/smoke.e2e.ts", target: "root", ownership: "seed" },
  ],
  deps: {
    devDependencies: {
      "@playwright/test": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## playwright\n\nPlaywright runs the end-to-end tests against the dev server.\n\nCommands:\n\n- `bun run test:e2e`: run every `e2e/*.e2e.ts` spec.\n\nKey files:\n\n- `playwright.config.ts`: browsers and the dev server; set `PLAYWRIGHT_BASE_URL` when the app is not on port 5173.\n- `e2e/smoke.e2e.ts`: a starter spec, yours to replace.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { "test:e2e": "playwright test" } },
    },
  ],
});
