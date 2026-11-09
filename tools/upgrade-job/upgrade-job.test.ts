import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curatedCombinations } from "../real-build/plan.ts";
import { applyEdit, indexAtRelease, lastPair, planEdits, releasePairs } from "./plan.ts";
import {
  type Exec,
  buildCases,
  pairsOf,
  readCatalogModules,
  readIndex,
  releasedCombinations,
  runJob,
} from "./run.ts";

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

function entry(latest: string, versions: string[]) {
  return {
    latest,
    versions: Object.fromEntries(versions.map((version) => [version, {}])),
  };
}

describe("release pairs and historical indexes", () => {
  test("pairs are consecutive and oldest first", () => {
    expect(releasePairs(["2026.11.1", "2026.11.0", "2026.12.0"])).toEqual([
      ["2026.11.0", "2026.11.1"],
      ["2026.11.1", "2026.12.0"],
    ]);
  });

  test("the index at the first Release drops later Releases and steps Modules back", async () => {
    const registry = join(workspaceRoot, "registry");
    const index = await readIndex(registry);
    const modules = await readCatalogModules(registry, index, "2026.11.0");
    const earlier = indexAtRelease(index, "2026.11.0", modules);
    expect(earlier.release).toBe("2026.11.0");
    expect(Object.keys(earlier.releases)).toEqual(["2026.11.0"]);
    expect(earlier.modules["vite-react"]?.latest).toBe("1.0.0");
    expect(Object.keys(earlier.modules["vite-react"]?.versions ?? {})).toEqual(["1.0.0"]);
    expect(earlier.modules["oxc"]?.latest).toBe("1.0.0");
    expect(earlier.modules["hono"]?.latest).toBe("1.0.0");
  });

  test("the last pair of three Releases is the newest N-1 to N", () => {
    expect(lastPair(["2026.11.2", "2026.11.0", "2026.11.1"])).toEqual(["2026.11.1", "2026.11.2"]);
  });

  test("a single Release has no pair", () => {
    expect(() => lastPair(["2026.11.0"])).toThrow("at least two Releases");
  });

  test("the index at a Release follows the Catalog modules map, not a version count", () => {
    const index = {
      release: "2026.11.2",
      releases: { "2026.11.0": {}, "2026.11.1": {}, "2026.11.2": {} },
      modules: {
        hono: entry("1.2.0", ["1.0.0", "1.1.0", "1.2.0"]),
        oxc: entry("1.1.0", ["1.0.0", "1.1.0"]),
        fresh: entry("1.0.0", ["1.0.0"]),
      },
    };
    const atMiddle = indexAtRelease(index, "2026.11.1", { hono: "1.0.0", oxc: "1.1.0" });
    expect(Object.keys(atMiddle.releases)).toEqual(["2026.11.0", "2026.11.1"]);
    expect(atMiddle.release).toBe("2026.11.1");
    expect(atMiddle.modules["hono"]?.latest).toBe("1.0.0");
    expect(Object.keys(atMiddle.modules["hono"]?.versions ?? {})).toEqual(["1.0.0"]);
    expect(atMiddle.modules["oxc"]?.latest).toBe("1.1.0");
    expect(atMiddle.modules["fresh"]).toBeUndefined();
  });

  test("with three Releases in the index the job plans exactly the last pair", async () => {
    const registry = scratchDirectory();
    const releases = { "2026.11.0": {}, "2026.11.1": {}, "2026.11.2": {} };
    await Bun.write(join(registry, "index.json"), JSON.stringify({ releases, modules: {} }));
    expect(await pairsOf(registry)).toEqual([["2026.11.1", "2026.11.2"]]);
  });

  test("the committed Registry has the 2026.11.1 -> 2026.11.2 pair", async () => {
    expect(await pairsOf(join(workspaceRoot, "registry"))).toContainEqual([
      "2026.11.1",
      "2026.11.2",
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
      {
        kind: "user-import",
        path: "apps/web/src/user-routes.ts",
        marker: "upgradeJobUserRoute",
        importFrom: "./routes",
      },
      { kind: "user-note", path: "AGENTS.md", marker: "upgradeJobAgentsNote" },
    ]);
  });

  test("the user importer targets ./router when the base Lockfile already holds src/router.tsx", () => {
    const routerFiles = {
      ...files,
      "apps/web/src/router.tsx": { mode: "managed", owners: ["vite-react"] },
    };
    const importer = planEdits(routerFiles, ["vite-react"]).find(
      (edit) => edit.kind === "user-import",
    );
    expect(importer?.importFrom).toBe("./router");
    expect(importer === undefined ? "" : applyEdit(importer, "")).toContain('from "./router"');
  });

  test("the AGENTS.md edit appends a user note and keeps the existing text", () => {
    const note = { kind: "user-note", path: "AGENTS.md", marker: "upgradeJobAgentsNote" } as const;
    const edited = applyEdit(
      note,
      "<!-- aokit:begin aokit:header -->\nx\n<!-- aokit:end aokit:header -->\n",
    );
    expect(edited.startsWith("<!-- aokit:begin aokit:header -->")).toBe(true);
    expect(edited.endsWith("upgradeJobAgentsNote\n")).toBe(true);
    expect(applyEdit(note, "")).toContain("upgradeJobAgentsNote");
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

describe("releasedCombinations", () => {
  test("drops selections that name a Module the index does not publish", async () => {
    const index = await readIndex(join(workspaceRoot, "registry"));
    const kept = { layout: "single", modules: ["oxc", "knip"] } as const;
    const pending = { layout: "single", modules: ["oxc", "pending-module"] } as const;
    expect(releasedCombinations([kept, pending], index)).toEqual([kept]);
  });
});
