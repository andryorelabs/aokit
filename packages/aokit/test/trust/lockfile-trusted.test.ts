import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { lockfileSchema } from "../../src/lockfile/schema.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");

const baseLockfile = {
  $schema: "https://aokit.andryore.dev/schema/lockfile/v2.json",
  lockfileVersion: 2,
  cliVersion: "0.1.0",
  protocolVersion: 1,
  layout: "single",
  modules: {},
  files: {},
  deps: {},
};

test("a Lockfile v2 Registry entry accepts an optional trusted flag", () => {
  const parsed = lockfileSchema.parse({
    ...baseLockfile,
    registries: {
      acme: {
        source: "https://r.test",
        release: "2026.11.0",
        minCliVersion: "0.1.0",
        trusted: true,
      },
      official: { source: "bundled", release: "2026.11.0", minCliVersion: "0.1.0" },
    },
  });
  expect(parsed.lockfileVersion).toBe(2);
  expect(parsed.registries.acme?.trusted).toBe(true);
  expect(parsed.registries.official?.trusted).toBeUndefined();
});

test("a non-boolean trusted flag is rejected", () => {
  const result = lockfileSchema.safeParse({
    ...baseLockfile,
    registries: {
      acme: {
        source: "https://r.test",
        release: "2026.11.0",
        minCliVersion: "0.1.0",
        trusted: "yes",
      },
    },
  });
  expect(result.success).toBe(false);
});

test("schema/lockfile/v2.json declares the optional trusted flag", async () => {
  const committed = z
    .looseObject({
      properties: z.looseObject({
        registries: z.looseObject({
          additionalProperties: z.looseObject({
            properties: z.record(z.string(), z.unknown()),
            required: z.array(z.string()),
          }),
        }),
      }),
    })
    .parse(JSON.parse(await readFile(join(repoRoot, "schema", "lockfile", "v2.json"), "utf8")));
  const entry = committed.properties.registries.additionalProperties;
  expect(entry.properties.trusted).toEqual({ type: "boolean" });
  expect(entry.required).not.toContain("trusted");
});
