import { defineModule } from "@aokit/module";

export default defineModule({
  name: "eslint",
  version: "1.0.0",
  provides: [{ capability: "lint:companion", cardinality: "many" }],
  requires: ["lint", "ext:lint.ignores@^1"],
  files: [
    {
      from: "files/eslint.config.mjs.txt",
      to: "eslint.config.mjs",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      eslint: { range: "catalog" },
      "eslint-plugin-astro": { range: "catalog" },
      "typescript-eslint": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## eslint\n\nESLint runs next to the main linter for `.astro` files and the type-aware rules Oxlint cannot run.\n\nCommands:\n\n- `bun run lint:eslint`: run ESLint.\n\nKey files:\n\n- `eslint.config.mjs`: the flat config, at the Project root.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { "lint:eslint": "eslint ." } },
    },
    {
      op: "mergeJson",
      extensionPoint: "lint.ignores",
      range: "^1",
      value: [".astro/**"],
    },
  ],
});
