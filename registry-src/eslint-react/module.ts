import { defineModule } from "@aokit/module";

const configsRegion = `import eslintReact from "@eslint-react/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

contributedConfigs.push(
  jsxA11y.flatConfigs.recommended,
  reactHooks.configs.flat.recommended,
  { files: ["**/*.{ts,tsx,mts,cts}"], ...eslintReact.configs["recommended-type-checked"] },
);`;

export default defineModule({
  name: "eslint-react",
  version: "1.0.1",
  description: "React-specific ESLint rules from eslint-react.",
  requires: ["web:react", "ext:eslint.configs@^1"],
  deps: {
    devDependencies: {
      "@eslint-react/eslint-plugin": { range: "catalog" },
      "eslint-plugin-jsx-a11y": { range: "catalog" },
      "eslint-plugin-react-hooks": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      extensionPoint: "eslint.configs",
      range: "^1",
      region: "configs",
      content: configsRegion,
    },
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## eslint-react\n\nESLint React rules for the web Target: accessibility (`eslint-plugin-jsx-a11y`), hooks (`eslint-plugin-react-hooks`) and React best practices (`@eslint-react/eslint-plugin`).\n\nCommands:\n\n- `bun run lint:eslint`: run ESLint with these rules included.\n\nKey files:\n\n- `eslint.config.mjs`: the React configs are added through the `eslint.configs` Extension point.\n",
    },
  ],
});
