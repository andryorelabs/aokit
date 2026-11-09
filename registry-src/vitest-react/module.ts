import { defineModule } from "@aokit/module";

export default defineModule({
  name: "vitest-react",
  version: "1.0.0",
  requires: ["web:react", "test-runner:vitest"],
  files: [
    {
      from: "files/vitest.react.config.ts",
      to: "vitest.react.config.ts",
      target: "web",
      ownership: "seed",
    },
    {
      from: "files/greeting.dom-test.tsx",
      to: "src/greeting.dom-test.tsx",
      target: "web",
      ownership: "seed",
    },
    {
      from: "files/greeting.browser-test.tsx",
      to: "src/greeting.browser-test.tsx",
      target: "web",
      ownership: "seed",
    },
  ],
  deps: {
    devDependencies: {
      "@vitest/browser-playwright": { range: "catalog", target: "web" },
      "happy-dom": { range: "catalog", target: "web" },
      playwright: { range: "catalog", target: "web" },
      "vitest-browser-react": { range: "catalog", target: "web" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## vitest-react\n\nVitest runs React component tests in happy-dom and in a real browser through Playwright.\n\nCommands:\n\n- `bun run test:react`: run the happy-dom and browser projects.\n\nKey files:\n\n- `vitest.react.config.ts`: the two Vitest projects, yours to edit.\n- `src/greeting.dom-test.tsx`: a happy-dom starter test, yours to replace.\n- `src/greeting.browser-test.tsx`: a browser-mode starter test, yours to replace.\n\nInstall the browser once with `bunx playwright install chromium`.\n",
    },
    {
      op: "mergeJson",
      target: "web",
      file: "package.json",
      value: { scripts: { "test:react": "vitest run -c vitest.react.config.ts" } },
    },
  ],
});
