import { expect, test } from "bun:test";
import { defineMigration, ManifestError, parseManifest } from "@aokit/module";

const baseManifest = { name: "web", version: "2.0.0" };

function withMigration(migration: Record<string, unknown>): unknown {
  return { ...baseManifest, migrations: [migration] };
}

function failureMessage(raw: unknown): string {
  try {
    parseManifest(raw);
  } catch (error) {
    if (error instanceof ManifestError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected the manifest to be invalid");
}

test("a migration with a semver range, stage and script validates", () => {
  const manifest = parseManifest(
    withMigration({
      from: ">=1 <2",
      to: "2.0.0",
      stage: "before",
      script: "migrations/1-to-2.before.js",
    }),
  );
  expect(manifest.migrations).toEqual([
    { from: ">=1 <2", to: "2.0.0", stage: "before", script: "migrations/1-to-2.before.js" },
  ]);
  expect(manifest.schemaVersion).toBe(1);
});

test("a `from` that is not a semver range fails naming the from field", () => {
  expect(
    failureMessage(
      withMigration({ from: "banana", to: "2.0.0", stage: "after", script: "migrations/a.js" }),
    ),
  ).toContain("migrations.0.from");
});

test("an unknown stage fails naming the stage field", () => {
  expect(
    failureMessage(
      withMigration({ from: ">=1", to: "2.0.0", stage: "pre", script: "migrations/a.js" }),
    ),
  ).toContain("migrations.0.stage");
});

test("a missing script fails naming the script field", () => {
  expect(failureMessage(withMigration({ from: ">=1", to: "2.0.0", stage: "after" }))).toContain(
    "migrations.0.script",
  );
});

test("an absolute or escaping script path fails naming the script field", () => {
  for (const script of ["/etc/x.js", "../x.js", "migrations\\x.js"]) {
    expect(
      failureMessage(withMigration({ from: ">=1", to: "2.0.0", stage: "after", script })),
    ).toContain("migrations.0.script");
  }
});

test("an unknown migration key fails", () => {
  expect(
    failureMessage(
      withMigration({ from: ">=1", to: "2.0.0", stage: "after", script: "a.js", extra: 1 }),
    ),
  ).toContain("extra");
});

test("defineMigration returns the script unchanged", () => {
  const script = defineMigration(({ answers }) => ({ ...answers, router: "x" }));
  const vfs = { read: () => undefined, write: () => {}, delete: () => {}, list: () => [] };
  const input = {
    vfs,
    answers: { appRouter: "x" },
    context: { now: new Date(0), random: () => 0 },
  };
  expect(script(input)).toEqual({ appRouter: "x", router: "x" });
});
