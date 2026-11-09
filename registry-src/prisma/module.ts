import { defineModule } from "@aokit/module";

export default defineModule({
  name: "prisma",
  version: "1.0.0",
  provides: [
    { capability: "orm", cardinality: { max: 1 } },
    { capability: "orm:prisma", cardinality: { max: 1 } },
  ],
  files: [
    { from: "files/schema.prisma", to: "prisma/schema.prisma", target: "db", ownership: "seed" },
    {
      from: "files/prisma.config.ts",
      to: "prisma.config.ts",
      target: "db",
      ownership: "managed",
    },
    { from: "files/client.ts.txt", to: "client.ts", target: "db", ownership: "seed" },
    {
      from: "files/SKILL.md",
      to: ".claude/skills/prisma/SKILL.md",
      target: "root",
      ownership: "managed",
    },
  ],
  deps: {
    dependencies: {
      "@prisma/client": { range: "catalog", pinGroup: "prisma" },
      "@prisma/adapter-pg": { range: "catalog", pinGroup: "prisma" },
      pg: { range: "catalog" },
    },
    devDependencies: {
      prisma: { range: "catalog", pinGroup: "prisma" },
      "@types/pg": { range: "catalog" },
    },
  },
  env: [
    {
      key: "DATABASE_URL",
      scope: "root",
      schema: "z.url()",
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
        "\n## prisma\n\nPrisma 7 with the `pg` driver adapter is the ORM. `DATABASE_URL` is the only connection setting, so hosted Postgres works without `postgres-compose`.\n\nCommands:\n\n- `bunx prisma migrate dev`: create and apply a migration locally.\n- `bunx prisma generate`: regenerate the client.\n\nKey files:\n\n- `prisma/schema.prisma`: the schema; other Modules add models through the `db.schema` Extension point.\n- `prisma.config.ts`: the Prisma CLI config; reads `DATABASE_URL`.\n- `client.ts`: the shared `PrismaClient` using the `pg` adapter.\n\nSkills:\n\n- `.claude/skills/prisma/SKILL.md`: how to change the schema and run migrations.\n",
    },
  ],
  extensionPoints: [
    {
      name: "db.schema",
      version: "1.0.0",
      target: "db",
      kind: "region",
      anchor: "schema",
      file: "prisma/schema.prisma",
    },
  ],
});
