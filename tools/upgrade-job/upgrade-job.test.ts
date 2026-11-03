import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curatedCombinations } from "../real-build/plan.ts";
import { applyEdit, indexAtRelease, planEdits, releasePairs } from "./plan.ts";
import { type Exec, buildCases, pairsOf, runJob } from "./run.ts";

const workspaceRoot = join(import.meta.dir, "..", "..");
const scratchRoots: string[] = [];

afterAll(async () => {
  await Promise.all(scratchRoots.map((root) => rm(root, { recursive: true, force: true })));
});

function scratchDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "aokit-upgrade-job-test-"));
  scratchRoots.push(root);
  return root;
}

const exec: Exec = async (command, cwd) => {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: stdout === "" ? stderr : stdout };
};

const skippingUpdate: Exec = (command, cwd) =>
  command.includes("update")
    ? Promise.resolve({ exitCode: 0, output: JSON.stringify({ data: { conflicts: [] } }) })
    : exec(command, cwd);

const conflicted: Exec = (command, cwd) =>
  command.includes("update")
    ? Promise.resolve({
        exitCode: 6,
        output: JSON.stringify({ data: { conflicts: [{ path: "a" }] } }),
      })
    : exec(command, cwd);

const firstSelection = curatedCombinations.filter(
  (combination) => combination.modules.includes("vite-react") && combination.layout === "monorepo",
);

describe("release pairs and historical indexes", () => {
  test("pairs are consecutive and oldest first", () => {
    expect(releasePairs(["2026.11.1", "2026.11.0", "2026.12.0"])).toEqual([
      ["2026.11.0", "2026.11.1"],
      ["2026.11.1", "2026.12.0"],
    ]);
  });

  test("the index at the first Release drops later Releases and steps Modules back", async () => {
    const index = await Bun.file(join(workspaceRoot, "registry/index.json")).json();
    const earlier = indexAtRelease(index, "2026.11.0");
    expect(earlier.release).toBe("2026.11.0");
    expect(Object.keys(earlier.releases)).toEqual(["2026.11.0"]);
    expect(earlier.modules["vite-react"]?.latest).toBe("1.0.0");
    expect(Object.keys(earlier.modules["vite-react"]?.versions ?? {})).toEqual(["1.0.0"]);
    expect(earlier.modules["oxc"]?.latest).toBe("1.0.0");
    expect(earlier.modules["hono"]?.latest).toBe("1.0.0");
  });

  test("the committed Registry has the 2026.11.0 -> 2026.11.1 pair", async () => {
    expect(await pairsOf(join(workspaceRoot, "registry"))).toContainEqual([
      "2026.11.0",
      "2026.11.1",
    ]);
  });
});

describe("representative edits", () => {
  const files = {
    ".oxlintrc.json": { mode: "managed", owners: ["oxc"] },
    "apps/web/src/main.tsx": { mode: "managed", owners: ["vite-react"] },
    "apps/web/src/routes.tsx": { mode: "managed", owners: ["vite-react"] },
    "apps/web/src/styles.css": { mode: "seed", owners: ["tailwind4"] },
    "apps/web/package.json": { mode: "managed", owners: ["vite-react", "tailwind4"] },
  };

  test("covers a managed text file, a managed JSON file, a seed and a ./routes importer", () => {
    expect(planEdits(files, ["oxc", "vite-react", "tailwind4"])).toEqual([
      { kind: "managed-text", path: "apps/web/src/routes.tsx", marker: "upgradeJobManagedEdit" },
      { kind: "managed-json", path: ".oxlintrc.json", marker: "upgradeJobJsonEdit" },
      { kind: "seed", path: "apps/web/src/styles.css", marker: "upgradeJobSeedEdit" },
      { kind: "user-import", path: "apps/web/src/user-routes.ts", marker: "upgradeJobUserRoute" },
    ]);
  });

  test("leaves out the importer without vite-react", () => {
    const kinds = planEdits(files, ["oxc"]).map((edit) => edit.kind);
    expect(kinds).not.toContain("user-import");
  });

  test("a JSON edit adds a key and keeps the document valid", () => {
    const edited = applyEdit(
      { kind: "managed-json", path: "a.json", marker: "upgradeJobJsonEdit" },
      '{\n  "rules": {}\n}\n',
    );
    expect(JSON.parse(edited)).toEqual({ upgradeJobJsonEdit: true, rules: {} });
  });
});

describe("the job against the committed Registry", () => {
  test("2026.11.0 -> 2026.11.1 holds for the vite-react selection on the monorepo Layout", async () => {
    const results = await runJob(
      buildCases([["2026.11.0", "2026.11.1"]], firstSelection),
      { exec, workspaceRoot, scratch: scratchDirectory(), log: () => undefined },
      () => undefined,
    );
    expect(results.map((result) => result.failures)).toEqual([[]]);
  }, 120_000);

  test("a case fails when the update leaves the Lockfile on the old Release", async () => {
    const results = await runJob(
      buildCases([["2026.11.0", "2026.11.1"]], firstSelection),
      { exec: skippingUpdate, workspaceRoot, scratch: scratchDirectory(), log: () => undefined },
      () => undefined,
    );
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.failures.join("\n")).toContain("Lockfile records 2026.11.0");
  }, 120_000);

  test("a case fails when the update reports Conflicts", async () => {
    const results = await runJob(
      buildCases([["2026.11.0", "2026.11.1"]], firstSelection),
      { exec: conflicted, workspaceRoot, scratch: scratchDirectory(), log: () => undefined },
      () => undefined,
    );
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.failures.join("\n")).toContain("exited 6");
    expect(results[0]?.failures.join("\n")).toContain("1 Conflicts");
  }, 120_000);
});
