import { describe, expect, test } from "bun:test";
import type { Plan, PlanChange } from "../../src/engine/plan.ts";
import { Vfs } from "../../src/engine/vfs.ts";
import { layoutRenames } from "../../src/layout/renames.ts";

type Entry = readonly [path: string, module: string, from: string, ownership?: "managed" | "seed"];

function planOf(entries: readonly Entry[]): Plan {
  const changes: PlanChange[] = entries.map(([path, module, from, ownership]) => ({
    type: "create",
    path,
    content: "x",
    ownership: ownership ?? "managed",
    mode: undefined,
    provenance: [{ module, entry: { kind: "file", from } }],
  }));
  return { changes, hash: "h", vfs: Vfs.empty() };
}

describe("layoutRenames", () => {
  test("pairs managed files by module and file entry", () => {
    const result = layoutRenames(
      planOf([["src/a.ts", "web", "a.ts"]]),
      planOf([["apps/web/src/a.ts", "web", "a.ts"]]),
    );
    expect([...result.renames]).toEqual([["src/a.ts", "apps/web/src/a.ts"]]);
    expect(result.seedMoves.size).toBe(0);
  });

  test("splits seed files into seed moves", () => {
    const result = layoutRenames(
      planOf([["src/s.ts", "web", "s.ts", "seed"]]),
      planOf([["apps/web/src/s.ts", "web", "s.ts", "seed"]]),
    );
    expect(result.renames.size).toBe(0);
    expect([...result.seedMoves]).toEqual([["src/s.ts", "apps/web/src/s.ts"]]);
  });

  test("excludes equal paths", () => {
    const result = layoutRenames(
      planOf([["a.ts", "web", "a.ts"]]),
      planOf([["a.ts", "web", "a.ts"]]),
    );
    expect(result.renames.size).toBe(0);
  });

  test("does not pair across modules", () => {
    const result = layoutRenames(
      planOf([["a.ts", "web", "a.ts"]]),
      planOf([["b.ts", "api", "a.ts"]]),
    );
    expect(result.renames.size).toBe(0);
  });

  test("excludes many-to-one targets", () => {
    const result = layoutRenames(
      planOf([
        ["one/a.ts", "web", "a.ts"],
        ["two/b.ts", "web", "b.ts"],
      ]),
      planOf([
        ["merged.ts", "web", "a.ts"],
        ["merged.ts", "web", "b.ts"],
      ]),
    );
    expect(result.renames.size).toBe(0);
  });

  test("excludes an entry that lands on several paths", () => {
    const result = layoutRenames(
      planOf([["a.ts", "web", "a.ts"]]),
      planOf([
        ["x/a.ts", "web", "a.ts"],
        ["y/a.ts", "web", "a.ts"],
      ]),
    );
    expect(result.renames.size).toBe(0);
  });
});
