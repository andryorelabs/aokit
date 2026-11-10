import { describe, expect, test } from "bun:test";
import { type ModuleManifest } from "@aokit/module";
import { resolve } from "../../src/resolver/resolve.ts";
import { pairwiseSelections } from "./pairwise.ts";
import { fixtureManifest } from "../helpers/fixture-manifest.ts";

function mod(input: { name: string; provides?: string[]; requires?: string[] }): ModuleManifest {
  return fixtureManifest(input);
}

function cover(manifests: readonly ModuleManifest[]): string[][] {
  return pairwiseSelections(
    manifests.map((manifest) => manifest.name),
    (modules) => resolve({ modules }, manifests),
  );
}

describe("pairwiseSelections", () => {
  test("a Module whose requires nobody provides is skipped and does not hang", () => {
    const result = cover([
      mod({ name: "alpha" }),
      mod({ name: "beta", provides: ["thing"] }),
      mod({ name: "orphan", requires: ["missing"] }),
    ]);
    expect(result.flat()).not.toContain("orphan");
    expect(result.flat()).toContain("alpha");
  });

  test("a requirement cycle the Resolver rejects ends with no selection", () => {
    const result = cover([
      mod({ name: "left", provides: ["l"], requires: ["r"] }),
      mod({ name: "right", provides: ["r"], requires: ["l"] }),
    ]);
    expect(result).toEqual([]);
  });

  test("covers every provider alternative of a requirement", () => {
    const result = cover([
      mod({ name: "app", requires: ["orm"] }),
      mod({ name: "drizzle", provides: ["orm"] }),
      mod({ name: "prisma", provides: ["orm"] }),
    ]);
    expect(result).toContainEqual(["app", "drizzle"]);
    expect(result).toContainEqual(["app", "prisma"]);
  });

  test("covers a provider alternative beyond the fourth", () => {
    const providers = Array.from({ length: 6 }, (_, index) =>
      mod({ name: `prov-${index}`, provides: ["orm"] }),
    );
    const result = cover([mod({ name: "app", requires: ["orm"] }), ...providers]);
    expect(result).toContainEqual(["app", "prov-5"]);
  });

  test(
    "a synthetic 45-Module fixture covers within its timeout",
    () => {
      const manifests: ModuleManifest[] = [];
      for (let index = 0; index < 45; index += 1) {
        const requires = index % 3 === 0 && index > 0 ? [`cap-${index - 1}`] : [];
        manifests.push(
          mod({
            name: `mod-${String(index).padStart(2, "0")}`,
            provides: [`cap-${index}`],
            requires,
          }),
        );
      }
      manifests.push(mod({ name: "unsatisfiable", requires: ["nobody-provides-this"] }));
      const result = cover(manifests);
      for (const selection of result) {
        expect(resolve({ modules: selection }, manifests).ok).toBe(true);
      }
      expect(result.flat()).not.toContain("unsatisfiable");
      expect(result.flat()).toContain("mod-44");
    },
    { timeout: 30_000 },
  );
});
