import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { LayoutName } from "../../src/engine/layout.ts";
import { resolve } from "../../src/resolver/resolve.ts";
import { buildSelection } from "../modules/support/index.ts";
import { type Selection, pairwiseSelections } from "./pairwise.ts";
import { loadCuratedSets, loadSourceManifests } from "./source.ts";

const layouts: readonly LayoutName[] = ["single", "monorepo"];

async function buildDigest(
  selection: Selection,
  layout: LayoutName,
): Promise<{ readonly planHash: string; readonly digest: string }> {
  const built = await buildSelection(selection, layout);
  if (!built.ok) {
    throw new Error(`${layout} ${selection.join(",")}: ${built.error.message}`);
  }
  const lockfileDigest = createHash("sha256").update(built.lockfileText).digest("hex");
  return {
    planHash: built.plan.hash,
    digest: `plan=${built.plan.hash} lockfile=${lockfileDigest}`,
  };
}

const baselineFile = join(import.meta.dir, "curated-digests.txt");

/**
 * Builds every curated set on every Layout it declares and returns one `layout slug digest` line
 * per combination, in set then Layout order.
 */
async function curatedDigestLines(): Promise<string[]> {
  const lines: string[] = [];
  for (const set of loadCuratedSets()) {
    for (const layout of layouts) {
      if (set.layouts !== undefined && !set.layouts.includes(layout)) continue;
      // oxlint-disable-next-line eslint/no-await-in-loop -- fixed, ordered output
      const { digest } = await buildDigest([...set.modules], layout);
      lines.push(`${layout} ${set.slug} ${digest}`);
    }
  }
  return lines;
}

const manifests = await loadSourceManifests();
const names = manifests.map((manifest) => manifest.name);
const cover = pairwiseSelections(names, (modules) => resolve({ modules }, manifests));

/**
 * Regenerate the curated baseline on purpose, after an intended render change or a new curated
 * set: `AOKIT_UPDATE_CURATED_BASELINE=1 bun test packages/aokit/test/matrix/matrix.test.ts`,
 * then commit `packages/aokit/test/matrix/curated-digests.txt`.
 */
describe("capability-derived matrix", () => {
  test(
    "curated sets render to the committed digest baseline",
    async () => {
      const actual = `${(await curatedDigestLines()).join("\n")}\n`;
      if (process.env["AOKIT_UPDATE_CURATED_BASELINE"] === "1") {
        await writeFile(baselineFile, actual);
      }
      expect(actual).toBe(await readFile(baselineFile, "utf8"));
      const target = process.env["AOKIT_MATRIX_DIGEST_FILE"];
      if (target !== undefined && target !== "") {
        await writeFile(target, actual, { flag: "a" });
      }
    },
    { timeout: 120_000 },
  );

  test("covers the Modules the harness loader finds with selections the Resolver accepts", () => {
    expect(names.length).toBeGreaterThan(0);
    expect(cover.length).toBeGreaterThan(0);
    for (const selection of cover) {
      expect(resolve({ modules: selection }, manifests).ok).toBe(true);
    }
    expect(
      cover.some((selection) => selection.includes("coolify") && selection.includes("docker")),
    ).toBe(true);
    expect(cover).not.toContainEqual(["coolify"]);
    for (const name of names) {
      expect(cover.some((selection) => selection.includes(name))).toBe(true);
    }
  });

  test(
    "builds every combination twice with equal Plan hashes on both Layouts",
    async () => {
      const digests: Record<string, string> = {};
      for (const layout of layouts) {
        for (const selection of cover) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- fixed, ordered output
          const first = await buildDigest(selection, layout);
          // oxlint-disable-next-line eslint/no-await-in-loop -- fixed, ordered output
          const second = await buildDigest(selection, layout);
          expect(second.planHash).toBe(first.planHash);
          expect(second.digest).toBe(first.digest);
          digests[`${layout} ${selection.join(",")}`] = first.digest;
        }
      }
      const target = process.env["AOKIT_MATRIX_DIGEST_FILE"];
      if (target !== undefined && target !== "") {
        const lines = Object.entries(digests).map(([key, digest]) => `${key} ${digest}`);
        await writeFile(target, `${lines.join("\n")}\n`);
      }
    },
    { timeout: 120_000 },
  );
});
