import { expect, test } from "bun:test";
import { buildSelection } from "./support/index.ts";

test.each(["single", "monorepo"] as const)(
  "postgres-compose writes compose.yml and the DATABASE_URL example (%s)",
  async (layout) => {
    const built = await buildSelection(["postgres-compose"], layout);
    if (!built.ok) throw new Error(built.error.message);
    const { vfs } = built.plan;
    const compose = String(vfs.read("compose.yml"));
    expect(compose).toContain("image: postgres:17");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("pg_isready");
    expect(String(vfs.read(".env"))).toContain(
      "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app",
    );
  },
);

test("postgres-compose appends its agents Region", async () => {
  const built = await buildSelection(["postgres-compose"], "single");
  if (!built.ok) throw new Error(built.error.message);
  const agents = String(built.plan.vfs.read("AGENTS.md"));
  expect(agents).toContain("aokit:begin postgres-compose:agents");
  expect(agents).toContain("## postgres-compose");
});

test("postgres-compose and prisma resolve together", async () => {
  const built = await buildSelection(["postgres-compose", "prisma"], "single");
  expect(built.ok).toBe(true);
});
