import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planEdits } from "./plan.ts";
import { type Exec, type UpgradeCase, readCatalogModules, readIndex, runJob } from "./run.ts";

const workspaceRoot = join(import.meta.dir, "..", "..");
const scratchRoots: string[] = [];

afterAll(async () => {
  await Promise.all(scratchRoots.map((root) => rm(root, { recursive: true, force: true })));
});

function scratchDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "aokit-upgrade-job-coverage-"));
  scratchRoots.push(root);
  return root;
}

async function failureOf(attempt: Promise<unknown>): Promise<string> {
  return attempt.then(
    () => "",
    (error: unknown) => String(error),
  );
}

const upgradeCase: UpgradeCase = {
  from: "2026.11.0",
  to: "2026.11.1",
  layout: "single",
  modules: ["oxc"],
};

interface FakeOptions {
  readonly createExitCode?: number;
  readonly lock?: string;
  readonly updateOutput?: string;
}

function fakeExec(options: FakeOptions): Exec {
  return async (command) => {
    if (command.includes("create")) {
      if (options.createExitCode !== undefined && options.createExitCode !== 0) {
        return { exitCode: options.createExitCode, output: "boom" };
      }
      const directory = String(command[command.indexOf("create") + 1]);
      mkdirSync(directory, { recursive: true });
      await writeFile(join(directory, "aokit.lock.json"), options.lock ?? "{}");
      return { exitCode: 0, output: "" };
    }
    if (command.includes("update")) {
      return { exitCode: 0, output: options.updateOutput ?? "" };
    }
    return { exitCode: 0, output: "" };
  };
}

async function run(options: FakeOptions) {
  return runJob(
    [upgradeCase],
    { exec: fakeExec(options), workspaceRoot, scratch: scratchDirectory(), log: () => undefined },
    () => undefined,
  );
}

describe("registry index reading", () => {
  test("an index without releases and modules maps is rejected", async () => {
    const registry = scratchDirectory();
    await writeFile(join(registry, "index.json"), JSON.stringify({ releases: [] }));
    expect(await failureOf(readIndex(registry))).toContain("is not a Registry index");
  });

  test("a Release the index does not list is rejected", async () => {
    const registry = join(workspaceRoot, "registry");
    const index = await readIndex(registry);
    expect(await failureOf(readCatalogModules(registry, index, "1999.01.0"))).toContain(
      "does not list Release 1999.01.0",
    );
  });

  test("a Catalog that is not a JSON object is rejected", async () => {
    const registry = scratchDirectory();
    await writeFile(join(registry, "catalog.json"), "[]");
    const index = {
      release: "2026.11.0",
      releases: { "2026.11.0": { path: "catalog.json" } },
      modules: {},
    };
    expect(await failureOf(readCatalogModules(registry, index, "2026.11.0"))).toContain(
      "is not a JSON object",
    );
  });

  test("a Catalog whose modules is not a map is rejected", async () => {
    const registry = scratchDirectory();
    await writeFile(join(registry, "catalog.json"), JSON.stringify({ modules: 3 }));
    const index = {
      release: "2026.11.0",
      releases: { "2026.11.0": { path: "catalog.json" } },
      modules: {},
    };
    expect(await failureOf(readCatalogModules(registry, index, "2026.11.0"))).toContain(
      "has no Module map",
    );
  });
});

describe("a case against a stubbed CLI", () => {
  test("a failed create is reported as the case failure", async () => {
    const [result] = await run({ createExitCode: 3 });
    expect(result?.ok).toBe(false);
    expect(result?.failures.join("\n")).toContain("create exited 3");
  });

  test("a Lockfile that is not a JSON object aborts the case", async () => {
    expect(await failureOf(run({ lock: "[]" }))).toContain("is not a JSON object");
  });

  test("a Lockfile without a files map aborts the case", async () => {
    expect(await failureOf(run({ lock: "{}" }))).toContain("has no files map");
  });

  test("a Lockfile with a malformed file entry aborts the case", async () => {
    expect(await failureOf(run({ lock: JSON.stringify({ files: { "a.txt": 5 } }) }))).toContain(
      "malformed file entry",
    );
  });

  test("a Lockfile without a registries map aborts after the update", async () => {
    expect(
      await failureOf(
        run({ lock: JSON.stringify({ files: {} }), updateOutput: '{"data":{"conflicts":[]}}' }),
      ),
    ).toContain("has no registries map");
  });

  test.each([
    ["output that is not JSON", "not json"],
    ["an envelope without data", "{}"],
    ["data without a conflicts list", '{"data":{}}'],
  ])("%s counts as unknown Conflicts", async (_name, updateOutput) => {
    const [result] = await run({
      lock: JSON.stringify({ files: {}, registries: { default: { release: "2026.11.1" } } }),
      updateOutput,
    });
    expect(result?.ok).toBe(false);
    expect(result?.failures).toContain("update reported unknown Conflicts");
  });
});

describe("the text edit fallback", () => {
  test("a lone managed text file with one owner is edited when no routes file exists", () => {
    const edits = planEdits({ "src/app.tsx": { mode: "managed", owners: ["a"] } }, ["a"]);
    expect(edits[0]).toEqual({
      kind: "managed-text",
      path: "src/app.tsx",
      marker: "upgradeJobManagedEdit",
    });
  });
});
