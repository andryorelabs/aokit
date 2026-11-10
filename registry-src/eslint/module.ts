import { defineModule } from "@aokit/module";

export default defineModule({
  name: "eslint",
  version: "1.1.1",
  description: "ESLint companion that runs the rules Oxlint does not cover.",
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
      "@eslint-community/eslint-plugin-eslint-comments": { range: "catalog" },
      "eslint-plugin-astro": { range: "catalog" },
      "eslint-plugin-jsdoc": { range: "catalog" },
      "eslint-plugin-unicorn": { range: "catalog" },
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
        "\n## eslint\n\nESLint runs next to the main linter for `.astro` files and the type-aware rules Oxlint cannot run.\n\nCommands:\n\n- `bun run lint:eslint`: run ESLint.\n\nKey files:\n\n- `eslint.config.mjs`: the flat config, at the Project root; other Modules add configs through the `eslint.configs` Extension point.\n",
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
  extensionPoints: [
    {
      name: "eslint.configs",
      version: "1.0.0",
      target: "root",
      kind: "region",
      anchor: "configs",
      file: "eslint.config.mjs",
    },
  ],
});
