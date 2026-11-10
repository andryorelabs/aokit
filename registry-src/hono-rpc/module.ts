import { defineModule } from "@aokit/module";

export default defineModule({
  name: "hono-rpc",
  version: "1.0.1",
  description: "Typed Hono RPC client shared with the frontend.",
  provides: [{ capability: "api:rpc", cardinality: { max: 1 } }],
  requires: ["ext:server.routes@^1"],
  files: [
    {
      from: "files/client.ts.txt",
      to: "client.ts",
      target: "api-client",
      ownership: "seed",
    },
  ],
  deps: {
    dependencies: { hono: { range: "catalog" } },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## hono-rpc\n\nHono RPC gives the api-client Target a typed client for the Hono server.\n\nKey files:\n\n- `client.ts` in the api-client directory: `createApiClient(baseUrl)` returns a `hono/client` client typed by the server's `AppType`; it re-exports `AppType`.\n",
    },
  ],
});
