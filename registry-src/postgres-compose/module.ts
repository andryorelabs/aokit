import { defineModule } from "@aokit/module";

export default defineModule({
  name: "postgres-compose",
  version: "1.0.1",
  description: "Local PostgreSQL database through Docker Compose.",
  provides: [{ capability: "db:postgres", cardinality: { max: 1 } }],
  files: [{ from: "files/compose.yml", to: "compose.yml", target: "root", ownership: "managed" }],
  env: [
    {
      key: "DATABASE_URL",
      scope: "root",
      example: "postgresql://postgres:postgres@localhost:5432/app",
    },
  ],
  ops: [
    {
      op: "appendRegion",
      target: "root",
      file: "AGENTS.md",
      region: "agents",
      content:
        "\n## postgres-compose\n\nDocker Compose runs a local Postgres 17 for development.\n\nCommands:\n\n- `docker compose up -d --wait`: start Postgres and wait for its healthcheck.\n\nKey files:\n\n- `compose.yml`: the `postgres` service and its data volume.\n- `.env`: `DATABASE_URL` points at this database.\n",
    },
  ],
});
