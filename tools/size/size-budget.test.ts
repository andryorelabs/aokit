import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { measureSizes } from "./measure.ts";
import {
  findSizeFailures,
  loadSizeBudgets,
  parseSizeBudgets,
  type SizeBudgets,
} from "./size-budget.ts";

const budgets: SizeBudgets = {
  packages: { "packages/a": 1000 },
  binaries: { "aokit-linux-x64": 5000 },
};

describe("findSizeFailures", () => {
  test("passes at and under the budget", () => {
    expect(
      findSizeFailures(
        { packages: { "packages/a": 1000 }, binaries: { "aokit-linux-x64": 10 } },
        budgets,
      ),
    ).toEqual([]);
  });

  test("fails a package over budget with the measured and allowed size", () => {
    const failures = findSizeFailures({ packages: { "packages/a": 1500 }, binaries: {} }, budgets);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("packages/a");
    expect(failures[0]).toContain("measured 1,500 bytes");
    expect(failures[0]).toContain("allowed 1,000 bytes");
  });

  test("fails a binary over budget", () => {
    const failures = findSizeFailures(
      { packages: {}, binaries: { "aokit-linux-x64": 6000 } },
      budgets,
    );
    expect(failures[0]).toContain("Binary aokit-linux-x64");
    expect(failures[0]).toContain("allowed 5,000 bytes");
  });

  test("fails a measured item with no budget entry", () => {
    const failures = findSizeFailures({ packages: {}, binaries: { "aokit-new": 1 } }, budgets);
    expect(failures).toEqual([
      "Binary aokit-new has no entry in size-budgets.json; add its budget.",
    ]);
  });
});

describe("parseSizeBudgets", () => {
  test("reads both groups", () => {
    expect(parseSizeBudgets(JSON.stringify(budgets))).toEqual(budgets);
  });

  test("rejects a missing group and a bad limit", () => {
    expect(() => parseSizeBudgets("null")).toThrow("needs");
    expect(() => parseSizeBudgets('{"packages":{}}')).toThrow('"binaries"');
    expect(() => parseSizeBudgets('{"packages":{"a":-1},"binaries":{}}')).toThrow("positive");
  });

  test("the committed budgets load", () => {
    const committed = loadSizeBudgets();
    expect(Object.keys(committed.packages)).toContain("packages/aokit");
  });
});

describe("measureSizes", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("injects package sizes and reads built binaries, skipping unbuilt ones", async () => {
    const root = mkdtempSync(join(tmpdir(), "aokit-size-"));
    roots.push(root);
    expect(await measureSizes(root, budgets, () => Promise.resolve(7))).toEqual({
      packages: { "packages/a": 7 },
      binaries: {},
    });
    mkdirSync(join(root, "dist", "bin"), { recursive: true });
    writeFileSync(join(root, "dist", "bin", "aokit-linux-x64"), "12345");
    writeFileSync(join(root, "dist", "bin", "SHA256SUMS"), "x");
    const measured = await measureSizes(root, budgets, (dir) => Promise.resolve(dir.length));
    expect(measured.binaries).toEqual({ "aokit-linux-x64": 5 });
  });
});

function scriptsOf(): Record<string, string> {
  const manifest: unknown = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../../package.json"), "utf8"),
  );
  const scripts =
    typeof manifest === "object" && manifest !== null && "scripts" in manifest
      ? manifest.scripts
      : {};
  return Object.fromEntries(
    Object.entries(scripts ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

describe("gate wiring", () => {
  test("check runs check:package, which lints the package and runs the size gate", () => {
    const scripts = scriptsOf();
    expect(scripts["check"]).toContain("bun run check:package");
    expect(scripts["check:package"]).toContain("bun run lint:package");
    expect(scripts["check:package"]).toContain("bun run size");
    expect(scripts["size"]).toContain("tools/size/main.ts");
  });
});
