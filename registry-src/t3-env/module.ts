import { defineModule } from "@aokit/module";

export default defineModule({
  name: "t3-env",
  version: "1.0.0",
  provides: [{ capability: "env:validation", cardinality: { max: 1 } }],
  files: [{ from: "files/env.ts.txt", to: "src/env.ts", target: "config", ownership: "managed" }],
  deps: {
    dependencies: {
      "@t3-oss/env-core": { range: "catalog" },
      zod: { range: "catalog" },
    },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## t3-env\n\nT3 Env validates environment variables at startup.\n\nKey files:\n\n- `src/env.ts`: the validated `env` object, in the config Target. Modules that need an environment variable register its schema in `server` or `client`; the `client` prefix is `PUBLIC_`.\n",
    },
  ],
  extensionPoints: [
    {
      name: "env.server",
      version: "1.0.0",
      target: "config",
      kind: "object",
      anchor: "server",
      file: "src/env.ts",
    },
    {
      name: "env.client",
      version: "1.0.0",
      target: "config",
      kind: "object",
      anchor: "client",
      file: "src/env.ts",
    },
  ],
});
