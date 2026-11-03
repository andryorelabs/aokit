import { defineModule } from "@aokit/module";

export default defineModule({
  name: "hono",
  version: "1.0.0",
  provides: [
    { capability: "server", cardinality: { max: 1 } },
    { capability: "api:http", cardinality: { max: 1 } },
  ],
  files: [{ from: "files/app.ts", to: "app.ts", target: "server", ownership: "managed" }],
  deps: {
    dependencies: { hono: { range: "catalog" } },
    devDependencies: { "@types/bun": { range: "catalog" } },
  },
  extensionPoints: [
    {
      name: "server.middleware",
      version: "1.0.0",
      target: "server",
      kind: "array",
      anchor: "middleware",
      file: "app.ts",
    },
    {
      name: "server.routes",
      version: "1.0.0",
      target: "server",
      kind: "object",
      anchor: "routes",
      file: "app.ts",
    },
  ],
});
