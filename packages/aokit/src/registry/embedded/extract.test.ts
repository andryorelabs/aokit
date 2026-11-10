import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedRegistry, extractRegistryTo, renameWithRetry } from "./extract.ts";

const directories: string[] = [];

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aokit-extract-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function sampleRegistry(): Promise<EmbeddedRegistry> {
  const sources = await scratch();
  await writeFile(join(sources, "a"), '{"index":true}');
  await writeFile(join(sources, "b"), "nested");
  return {
    contentHash: "abc123",
    files: [
      { path: "index.json", source: join(sources, "a") },
      { path: "modules/x/1.0.0/module.json", source: join(sources, "b") },
    ],
  };
}

describe("extractRegistryTo", () => {
  test("writes the files under bundled-registry/<hash>", async () => {
    const cache = await scratch();
    const target = await extractRegistryTo(await sampleRegistry(), cache);
    expect(target).toBe(join(cache, "bundled-registry", "abc123"));
    expect(await readFile(join(target, "modules/x/1.0.0/module.json"), "utf8")).toBe("nested");
  });

  test("reuses an existing extraction without rewriting it", async () => {
    const cache = await scratch();
    const registry = await sampleRegistry();
    const target = await extractRegistryTo(registry, cache);
    await writeFile(join(target, "index.json"), "marker");
    expect(await extractRegistryTo(registry, cache)).toBe(target);
    expect(await readFile(join(target, "index.json"), "utf8")).toBe("marker");
  });

  test("concurrent extractions leave one directory and no staging leftovers", async () => {
    const cache = await scratch();
    const registry = await sampleRegistry();
    const targets = await Promise.all([
      extractRegistryTo(registry, cache),
      extractRegistryTo(registry, cache),
      extractRegistryTo(registry, cache),
    ]);
    expect(new Set(targets).size).toBe(1);
    expect(await readdir(join(cache, "bundled-registry"))).toEqual(["abc123"]);
  });
});

function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

async function rejectionOf(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
  } catch (thrown) {
    return thrown;
  }
  throw new Error("expected the rename to reject");
}

describe("renameWithRetry", () => {
  test("retries a transient EPERM and then succeeds", async () => {
    let calls = 0;
    await renameWithRetry("a", "b", () => {
      calls += 1;
      return calls < 3 ? Promise.reject(failure("EPERM")) : Promise.resolve();
    });
    expect(calls).toBe(3);
  });

  test("throws a non-transient error at once", async () => {
    let calls = 0;
    const rejected = await rejectionOf(() =>
      renameWithRetry("a", "b", () => {
        calls += 1;
        return Promise.reject(failure("ENOENT"));
      }),
    );
    expect(rejected).toMatchObject({ code: "ENOENT" });
    expect(calls).toBe(1);
  });

  test("gives up with the last transient error after eight attempts", async () => {
    let calls = 0;
    const rejected = await rejectionOf(() =>
      renameWithRetry("a", "b", () => {
        calls += 1;
        return Promise.reject(failure("EBUSY"));
      }),
    );
    expect(rejected).toMatchObject({ code: "EBUSY" });
    expect(calls).toBe(8);
  });
});
