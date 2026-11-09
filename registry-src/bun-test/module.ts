import { defineModule } from "@aokit/module";

export default defineModule({
  name: "bun-test",
  version: "1.0.0",
  provides: [{ capability: "test-runner", cardinality: { max: 1 } }],
  files: [
    { from: "files/smoke.test.ts", to: "tests/smoke.test.ts", target: "root", ownership: "seed" },
  ],
  deps: {
    devDependencies: {
      "@types/bun": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## bun-test\n\nBun's built-in test runner runs the unit tests.\n\nCommands:\n\n- `bun run test`: run every `*.test.ts` file.\n\nKey files:\n\n- `tests/smoke.test.ts`: a starter test, yours to replace.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { test: "bun test" } },
    },
  ],
});
