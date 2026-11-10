import { defineModule } from "@aokit/module";

export default defineModule({
  name: "shadcn-lint",
  version: "1.0.1",
  description: "Lint rules that keep shadcn/ui components consistent.",
  requires: ["ui:components", "lint"],
  files: [
    {
      from: "files/oxlintrc.shadcn.json",
      to: ".oxlintrc.shadcn.json",
      target: "config",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      "@shadcn/lint": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## shadcn-lint\n\nshadcn design-system lint rules (`@shadcn/lint`), run through Oxlint as a JS plugin.\n\nCommands:\n\n- `bun run lint:shadcn`: flag raw colors, arbitrary values and inline styles in components.\n\nKey files:\n\n- `.oxlintrc.shadcn.json`: the `shadcn/*` rules, in the config Target.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          "lint:shadcn": "oxlint -c {{target:config}}/.oxlintrc.shadcn.json",
        },
      },
    },
  ],
});
