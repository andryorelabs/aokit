import { defineModule } from "@aokit/module";

export default defineModule({
  name: "tsdown",
  version: "1.0.0",
  provides: [{ capability: "library", cardinality: { max: 1 } }],
  files: [
    { from: "files/tsdown.config.ts", to: "tsdown.config.ts", target: "lib", ownership: "managed" },
    {
      from: "files/tsconfig.lib.json",
      to: "tsconfig.lib.json",
      target: "lib",
      ownership: "seed",
    },
    { from: "files/index.ts", to: "src/index.ts", target: "lib", ownership: "seed" },
    { from: "files/cli.ts", to: "src/cli.ts", target: "lib", ownership: "seed" },
    {
      from: "files/skill/SKILL.md",
      to: ".claude/skills/tsdown-library/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    devDependencies: {
      "@arethetypeswrong/cli": { range: "catalog" },
      "@types/bun": { range: "catalog" },
      publint: { range: "catalog" },
      tsdown: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## tsdown\n\ntsdown bundles the library Target to ESM with type declarations.\n\nCommands:\n\n- `bun run build:lib`: bundle the library to `dist/`.\n- `bun run check:package`: run publint and Are the Types Wrong against the built package.\n- `bun run compile`: compile `src/cli.ts` to a standalone binary with `bun build --compile`.\n\nKey files:\n\n- `tsdown.config.ts`: entry points and output format.\n- `src/index.ts`: the public library entry, yours to edit.\n- `src/cli.ts`: the binary entry for `compile`, yours to edit.\n\nSkills:\n\n- `.claude/skills/tsdown-library/SKILL.md`: how to add entries and keep `exports` in step.\n",
    },
    {
      op: "appendRegion",
      target: "root",
      file: ".gitignore",
      region: "tsdown",
      content: "node_modules\ndist\n",
    },
    {
      op: "mergeJson",
      target: "lib",
      file: "package.json",
      value: {
        name: "my-library",
        version: "0.0.0",
        type: "module",
        main: "./dist/index.mjs",
        types: "./dist/index.d.mts",
        exports: {
          ".": "./dist/index.mjs",
          "./package.json": "./package.json",
        },
        files: ["dist"],
      },
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: {
        scripts: {
          "build:lib": "bun run --cwd {{target:lib}} tsdown",
          "check:package":
            "bun run --cwd {{target:lib}} publint && bun run --cwd {{target:lib}} attw --pack . --profile esm-only",
          compile:
            "bun build --compile {{target:lib}}/src/cli.ts --outfile {{target:lib}}/dist/cli",
        },
      },
    },
  ],
});
