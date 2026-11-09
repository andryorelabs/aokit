import { defineModule } from "@aokit/module";

export default defineModule({
  name: "vitest",
  version: "1.1.0",
  provides: [
    { capability: "test-runner", cardinality: { max: 1 } },
    { capability: "test-runner:vitest", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/vitest.config.ts", to: "vitest.config.ts", target: "root", ownership: "seed" },
    { from: "files/smoke.test.ts", to: "tests/smoke.test.ts", target: "root", ownership: "seed" },
  ],
  deps: {
    devDependencies: {
      "@vitest/coverage-v8": { range: "catalog" },
      vitest: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## vitest\n\nVitest runs the unit tests.\n\nCommands:\n\n- `bun run test`: run the suite once.\n- `bun run test:coverage`: run the suite with V8 coverage.\n\nKey files:\n\n- `vitest.config.ts`: Vitest configuration, yours to edit.\n- `tests/smoke.test.ts`: a starter test, yours to replace.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { test: "vitest run", "test:coverage": "vitest run --coverage" } },
    },
  ],
});
