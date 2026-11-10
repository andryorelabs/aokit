import { defineModule } from "@aokit/module";

export default defineModule({
  name: "dotenvx",
  version: "1.0.1",
  description: "Encrypted .env files with dotenvx.",
  provides: [{ capability: "env:encryption", cardinality: { max: 1 } }],
  files: [{ from: "files/env.example", to: ".env.example", target: "root", ownership: "seed" }],
  deps: {
    devDependencies: {
      "@dotenvx/dotenvx": { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## dotenvx\n\nDotenvx encrypts the `.env` files of this Project so they can be committed.\n\nCommands:\n\n- `bun run env:encrypt`: encrypt `.env` and write the private key to `.env.keys`.\n\nKey files:\n\n- `.env.example`: the variables the Project expects, without values.\n- `.env.keys`: the private decryption keys; ignored by Git, never commit it.\n",
    },
    {
      op: "appendRegion",
      target: "root",
      file: ".gitignore",
      region: "keys",
      content: ".env.keys",
    },
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { "env:encrypt": "dotenvx encrypt" } },
    },
  ],
});
