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

async function docBlock(heading: string): Promise<string> {
  const doc = await readFile(join(repoRoot, "docs", "architecture", "lockfile.md"), "utf8");
  const match = new RegExp(`## ${heading}\\n\\n\`\`\`json\\n([\\s\\S]*?)\`\`\``).exec(doc);
  if (match?.[1] === undefined) {
    throw new Error(`${heading} block not found in lockfile.md`);
  }
  return match[1];
}

async function docExample(): Promise<string> {
  return docBlock("Example \\(v2\\)");
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
  raw.lockfileVersion = 3;
  const error = captureError(() => parseLockfile(JSON.stringify(raw)));
  expect(error.code).toBe("LOCKFILE_TOO_NEW");
  expect(error.fix).toBe("Update the CLI.");
});

test("invalid JSON and a missing version are reported", () => {
  expect(captureError(() => parseLockfile("{")).code).toBe("LOCKFILE_INVALID_JSON");
  expect(captureError(() => parseLockfile("{}")).code).toBe("LOCKFILE_INVALID_VERSION");
});

test("a fixture v0 migration runs through the chain up to v2", async () => {
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
  const toCurrent: LockfileMigration = {
    from: 1,
    to: 2,
    migrate: (previous) => ({ ...looseObject.parse(previous), lockfileVersion: 2 }),
  };
  const result = parseLockfile(JSON.stringify(legacy), { migrations: [migration, toCurrent] });
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

test("schema/lockfile/v2.json matches the generated schema", async () => {
  const committed = await readFile(join(repoRoot, "schema", "lockfile", "v2.json"), "utf8");
  expect(committed).toBe(lockfileJsonSchemaText());
});

test("a v1 Lockfile parses as v2 with upgradedFrom 1 and reading leaves the file untouched", async () => {
  const v1Text = await docBlock("Example");
  const { lockfile, upgradedFrom } = parseLockfile(v1Text);
  expect(upgradedFrom).toBe(1);
  expect(lockfile.lockfileVersion).toBe(2);
  expect(Object.values(lockfile.modules).every((entry) => entry.selected)).toBe(true);
  expect(lockfile.deps.oxlint?.owners).toEqual(["next", "oxc"]);
  expect(serializeLockfile(lockfile)).toContain(
    '"aokit.andryore.dev/schema/lockfile/v2.json"'.slice(1, -1),
  );
  expect(serializeLockfile(lockfile).includes('"aokit"]')).toBe(false);

  const directory = await mkdtemp(join(tmpdir(), "aokit-lockfile-"));
  try {
    const path = join(directory, "aokit.lock.json");
    await writeFile(path, v1Text, "utf8");
    const result = await readLockfile(path);
    expect(result?.upgradedFrom).toBe(1);
    expect(await readFile(path, "utf8")).toBe(v1Text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a v2 Lockfile without selected or owners is rejected", async () => {
  const raw = await docExampleObject();
  const modules = looseObject.parse(raw.modules);
  const { selected: _selected, ...rest } = looseObject.parse(modules.oxc);
  raw.modules = { ...modules, oxc: rest };
  expect(captureError(() => parseLockfile(JSON.stringify(raw))).code).toBe("LOCKFILE_INVALID");
});

const v1FilesShape = z
  .object({ files: z.record(z.string(), z.object({ owners: z.array(z.string()) }).loose()) })
  .loose();

test("the v1 migration drops the aokit pseudo-owner from file owners", async () => {
  const v1 = v1FilesShape.parse(JSON.parse(await docBlock("Example")));
  for (const entry of Object.values(v1.files)) {
    entry.owners = ["aokit", ...entry.owners];
  }
  const { lockfile } = parseLockfile(JSON.stringify(v1));
  for (const file of Object.values(lockfile.files)) {
    expect(file.owners).not.toContain("aokit");
  }
});
