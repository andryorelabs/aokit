import { afterEach, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistryCache } from "../../src/registry/cache.ts";

const integrity = `sha256-${"b".repeat(64)}` as const;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function cacheDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aokit-registry-cache-failures-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

test("an entry whose manifest cannot be read for a reason other than absence rethrows that error", async () => {
  const dir = await cacheDirectory();
  await mkdir(join(dir, integrity, "manifest.json"), { recursive: true });
  const error = await rejection(createRegistryCache({ dir }).get(integrity));
  expect(error).toMatchObject({ code: "EISDIR" });
});

test("an entry that has a manifest but no files directory reads back with no files", async () => {
  const dir = await cacheDirectory();
  await mkdir(join(dir, integrity), { recursive: true });
  await writeFile(join(dir, integrity, "manifest.json"), "m\r\n", "utf8");
  const entry = await createRegistryCache({ dir }).get(integrity);
  expect(entry?.manifest).toBe("m\n");
  expect(entry?.files.size).toBe(0);
});

test("an entry whose files path is not a directory rethrows the read error", async () => {
  const dir = await cacheDirectory();
  await mkdir(join(dir, integrity), { recursive: true });
  await writeFile(join(dir, integrity, "manifest.json"), "m\n", "utf8");
  await writeFile(join(dir, integrity, "files"), "not a directory", "utf8");
  const error = await rejection(createRegistryCache({ dir }).get(integrity));
  expect(error).toMatchObject({ code: "ENOTDIR" });
});

async function putWithRenameFailures(
  failures: readonly string[],
): Promise<{ calls: number; outcome: unknown }> {
  const dir = await cacheDirectory();
  const realRename = fsPromises.rename;
  let calls = 0;
  const spy = spyOn(fsPromises, "rename").mockImplementation(async (from, to) => {
    const code = failures[calls];
    calls += 1;
    if (code !== undefined) throw Object.assign(new Error(`${code}: simulated`), { code });
    return realRename(from, to);
  });
  try {
    const outcome = await createRegistryCache({ dir })
      .put(integrity, { manifest: "m\n", files: new Map([["files/a.txt", "a\n"]]) })
      .then(
        () => "stored",
        (error: unknown) => error,
      );
    return { calls, outcome };
  } finally {
    spy.mockRestore();
  }
}

test("a put that finds its target recreated by a concurrent writer removes it and retries the move", async () => {
  const { calls, outcome } = await putWithRenameFailures(["ENOTEMPTY", "EEXIST"]);
  expect(outcome).toBe("stored");
  expect(calls).toBe(3);
});

test("a put gives up after three occupied-target attempts and rethrows the last error", async () => {
  const { calls, outcome } = await putWithRenameFailures(["ENOTEMPTY", "ENOTEMPTY", "ENOTEMPTY"]);
  expect(outcome).toMatchObject({ code: "ENOTEMPTY" });
  expect(calls).toBe(3);
});

test("a put whose move fails for another reason rethrows it without a retry", async () => {
  const { calls, outcome } = await putWithRenameFailures(["EACCES"]);
  expect(outcome).toMatchObject({ code: "EACCES" });
  expect(calls).toBe(1);
});
