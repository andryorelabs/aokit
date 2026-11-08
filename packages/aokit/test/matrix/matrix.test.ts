import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { LayoutName } from "../../src/engine/layout.ts";
import { resolve } from "../../src/resolver/resolve.ts";
import { buildSelection } from "../modules/support/index.ts";
import { type Selection, pairwiseSelections } from "./pairwise.ts";
import { loadSourceManifests } from "./source.ts";

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

const manifests = await loadSourceManifests();
const names = manifests.map((manifest) => manifest.name);
const cover = pairwiseSelections(names, (modules) => resolve({ modules }, manifests));

describe("capability-derived matrix", () => {
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
