import { defineModule } from "@aokit/module";

export default defineModule({
  name: "hono-zod-validator",
  version: "1.0.1",
  description: "Request validation for Hono routes with Zod.",
  requires: ["ext:server.routes@^1"],
  deps: {
    dependencies: {
      "@hono/zod-validator": { range: "catalog" },
      hono: { range: "catalog" },
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
        '\n## hono-zod-validator\n\nHono Zod Validator checks request input in Hono routes against Zod schemas.\n\nKey files:\n\n- `src/app.ts`: registers a sample `/echo` route through `server.routes`; it validates a JSON body with `zValidator("json", schema)`. Copy that pattern for your own routes.\n',
    },
    {
      op: "addImport",
      target: "server",
      extensionPoint: "server.routes",
      range: "^1",
      from: "@hono/zod-validator",
      named: ["zValidator"],
    },
    {
      op: "addImport",
      target: "server",
      extensionPoint: "server.routes",
      range: "^1",
      from: "zod",
      named: ["z"],
    },
    {
      op: "registerAt",
      target: "server",
      extensionPoint: "server.routes",
      range: "^1",
      key: '"/echo"',
      expression:
        'new Hono().post("/", zValidator("json", z.object({ message: z.string().min(1) })), (context) => context.json(context.req.valid("json")))',
    },
  ],
});
