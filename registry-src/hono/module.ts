import { defineModule } from "@aokit/module";

export default defineModule({
  name: "hono",
  version: "1.2.1",
  description: "Hono server with typed routes and middleware.",
  provides: [
    { capability: "server", cardinality: { max: 1 } },
    { capability: "api:http", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/app.ts", to: "src/app.ts", target: "server", ownership: "managed" },
    {
      from: "files/hono-add-route.SKILL.md",
      to: ".claude/skills/hono-add-route/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: { hono: { range: "catalog" } },
    devDependencies: { "@types/bun": { range: "catalog" } },
  },
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## hono\n\nHono provides the HTTP server Target.\n\nCommands:\n\n- `bun run start`: start the server.\n\nKey files:\n\n- `src/app.ts`: the Hono app; add middleware and routes through its extension points. It exports `type AppType` for typed clients.\n\nSkills:\n\n- `.claude/skills/hono-add-route/SKILL.md`: how to add a route to this server.\n",
    },
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
