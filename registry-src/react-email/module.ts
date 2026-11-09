import { defineModule } from "@aokit/module";

export default defineModule({
  name: "react-email",
  version: "1.0.0",
  provides: [{ capability: "email:templates", cardinality: { max: 1 } }],
  files: [
    {
      from: "files/welcome.tsx",
      to: "welcome.tsx",
      target: "emails",
      ownership: "seed",
    },
  ],
  deps: {
    dependencies: {
      "@react-email/components": { range: "catalog" },
      react: { range: "catalog" },
    },
    devDependencies: {
      "react-email": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## react-email\n\nReact Email builds HTML emails from React components.\n\nCommands:\n\n- `bun run email:dev`: preview the templates.\n- `bun run email:build`: build the preview app.\n- `bun run email:export`: export the templates as static HTML.\n\nKey files:\n\n- `welcome.tsx` in the emails directory: a starter template, yours to edit.\n",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          "email:dev": "bun run --cwd {{target:emails}} email dev --dir .",
          "email:build": "bun run --cwd {{target:emails}} email build --dir .",
          "email:export": "bun run --cwd {{target:emails}} email export --dir .",
        },
      },
    },
  ],
});
