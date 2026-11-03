import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { z } from "zod";
import { join } from "node:path";
import {
  LockfileError,
  lockfileJsonSchemaText,
  parseLockfile,
  readLockfile,
  serializeLockfile,
  type LockfileMigration,
} from "../../src/lockfile/index.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const fixturePath = join(import.meta.dir, "fixtures", "example.canonical.lock");

async function docExample(): Promise<string> {
  const doc = await readFile(join(repoRoot, "docs", "architecture", "lockfile.md"), "utf8");
  const match = /## Example\n\n```json\n([\s\S]*?)```/.exec(doc);
  if (match?.[1] === undefined) {
    throw new Error("example block not found in lockfile.md");
  }
  return match[1];
}

const looseObject = z.record(z.string(), z.unknown());

async function docExampleObject(): Promise<Record<string, unknown>> {
  return looseObject.parse(JSON.parse(await docExample()));
}

function captureError(action: () => unknown): LockfileError {
  try {
    action();
  } catch (error) {
    if (error instanceof LockfileError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a LockfileError");
}

test("the lockfile.md example parses and re-serializes byte-identically", async () => {
  const { lockfile, upgradedFrom } = parseLockfile(await docExample());
  expect(upgradedFrom).toBeNull();
  const text = serializeLockfile(lockfile);
  expect(text).toBe(await readFile(fixturePath, "utf8"));
  expect(serializeLockfile(parseLockfile(text).lockfile)).toBe(text);
  expect(text.endsWith("}\n")).toBe(true);
  expect(text.includes("\r")).toBe(false);
});

test("serialization sorts keys at every level regardless of input order", async () => {
  const { lockfile } = parseLockfile(await docExample());
  const shuffled = {
    deps: lockfile.deps,
    files: lockfile.files,
    modules: lockfile.modules,
    registries: lockfile.registries,
    layout: lockfile.layout,
    protocolVersion: lockfile.protocolVersion,
    cliVersion: lockfile.cliVersion,
    lockfileVersion: lockfile.lockfileVersion,
    $schema: lockfile.$schema,
  };
  expect(serializeLockfile(shuffled)).toBe(serializeLockfile(lockfile));
});

test("unknown fields are rejected", async () => {
  const raw = await docExampleObject();
  raw.createdAt = "2026-01-01";
  const error = captureError(() => parseLockfile(JSON.stringify(raw)));
  expect(error.code).toBe("LOCKFILE_INVALID");
});

test("a newer lockfileVersion fails telling the user to update the CLI", async () => {
  const raw = await docExampleObject();
  raw.lockfileVersion = 2;
  const error = captureError(() => parseLockfile(JSON.stringify(raw)));
  expect(error.code).toBe("LOCKFILE_TOO_NEW");
  expect(error.fix).toBe("Update the CLI.");
});

test("invalid JSON and a missing version are reported", () => {
  expect(captureError(() => parseLockfile("{")).code).toBe("LOCKFILE_INVALID_JSON");
  expect(captureError(() => parseLockfile("{}")).code).toBe("LOCKFILE_INVALID_VERSION");
});

test("a fixture v0 to v1 migration runs through the chain", async () => {
  const current = await docExampleObject();
  const { deps, ...rest } = current;
  const legacy = { ...rest, lockfileVersion: 0, dependencies: deps };
  const migration: LockfileMigration = {
    from: 0,
    to: 1,
    migrate(previous) {
      const { dependencies, ...others } = looseObject.parse(previous);
      return { ...others, lockfileVersion: 1, deps: dependencies };
    },
  };
  const result = parseLockfile(JSON.stringify(legacy), { migrations: [migration] });
  expect(result.upgradedFrom).toBe(0);
  expect(serializeLockfile(result.lockfile)).toBe(await readFile(fixturePath, "utf8"));
});

test("the chain runs every step in order and never skips a version", () => {
  const visited: number[] = [];
  const step = (from: number): LockfileMigration => ({
    from,
    to: from + 1,
    migrate(previous) {
      visited.push(from);
      return { ...looseObject.parse(previous), lockfileVersion: from + 1 };
    },
  });
  const base = { lockfileVersion: 0 };
  const passthrough = [step(0), step(1), step(2)];
  expect(() =>
    parseLockfile(JSON.stringify(base), { supportedVersion: 3, migrations: passthrough }),
  ).toThrow(LockfileError);
  expect(visited).toEqual([0, 1, 2]);

  const withGap = [step(0), step(2)];
  const error = captureError(() =>
    parseLockfile(JSON.stringify(base), { supportedVersion: 3, migrations: withGap }),
  );
  expect(error.code).toBe("LOCKFILE_NO_MIGRATION");

  const skipping: LockfileMigration = { from: 0, to: 2, migrate: (previous) => previous };
  const skipError = captureError(() =>
    parseLockfile(JSON.stringify(base), { supportedVersion: 2, migrations: [skipping] }),
  );
  expect(skipError.code).toBe("LOCKFILE_NO_MIGRATION");
});

test("reading never writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aokit-lockfile-"));
  try {
    const path = join(directory, "aokit.lock.json");
    expect(await readLockfile(path)).toBeNull();
    await writeFile(path, await docExample(), "utf8");
    const before = await readFile(path, "utf8");
    const result = await readLockfile(path);
    expect(result?.lockfile.layout).toBe("monorepo");
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await readdir(directory)).toEqual(["aokit.lock.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("schema/lockfile/v1.json matches the generated schema", async () => {
  const committed = await readFile(join(repoRoot, "schema", "lockfile", "v1.json"), "utf8");
  expect(committed).toBe(lockfileJsonSchemaText());
});
