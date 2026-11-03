import { defineModule } from "@aokit/module";

export default defineModule({
  name: "hono",
  version: "1.0.0",
  provides: [
    { capability: "server", cardinality: { max: 1 } },
    { capability: "api:http", cardinality: { max: 1 } },
  ],
  files: [{ from: "files/app.ts", to: "src/app.ts", target: "server", ownership: "managed" }],
  deps: {
    dependencies: { hono: { range: "catalog" } },
    devDependencies: { "@types/bun": { range: "catalog" } },
  },
  ops: [
    {
      op: "mergeJson",
      target: "root",
      file: "package.json",
      value: { scripts: { start: "bun run {{target:server}}/src/app.ts" } },
    },
  ],
  extensionPoints: [
    {
      name: "server.middleware",
      version: "1.0.0",
      target: "server",
      kind: "array",
      anchor: "middleware",
      file: "src/app.ts",
    },
    {
      name: "server.routes",
      version: "1.0.0",
      target: "server",
      kind: "object",
      anchor: "routes",
      file: "src/app.ts",
    },
  ],
});
