---
name: prisma
description: Change the database schema, run migrations and regenerate the Prisma client. Use when adding a model, changing a field or wiring a Module that stores data.
---

# Working with Prisma

1. The schema is `prisma/schema.prisma` in the db Target. Other Modules add their models inside their own `// aokit:begin <module>:schema` Region; keep your models outside those Regions.
2. `DATABASE_URL` is the only connection setting. `prisma.config.ts` reads it; `createPrismaClient` in `client.ts` takes it as an argument and passes it to the `pg` driver adapter.
3. After editing the schema, run `bun run db:migrate` locally, then `bun run db:generate`. A fresh checkout needs `bun run db:generate` once before the client exists.
4. Deploy migrations with `bun run db:deploy`; never run `migrate dev` against a shared database.
5. Create the client with `createPrismaClient(connectionString)` from `client.ts` instead of constructing a `PrismaClient` elsewhere.
6. Keep `prisma`, `@prisma/client` and `@prisma/adapter-pg` on the same version; they are a Toolchain pin group and move together.
