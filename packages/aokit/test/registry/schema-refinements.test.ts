import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registryIndexSchema } from "../../src/registry/schema.ts";

const builtIndex = resolve(import.meta.dir, "../../../../registry/index.json");

function loadIndex(): ReturnType<typeof registryIndexSchema.parse> {
  const raw: unknown = JSON.parse(readFileSync(builtIndex, "utf8"));
  return registryIndexSchema.parse(raw);
}

function firstModule(index: ReturnType<typeof loadIndex>) {
  const [name, entry] = Object.entries(index.modules)[0] ?? [];
  if (name === undefined || entry === undefined) throw new Error("the built index lists no Module");
  return { name, entry };
}

function issuesOf(index: unknown): string {
  const result = registryIndexSchema.safeParse(index);
  return result.success ? "" : result.error.issues.map((issue) => issue.message).join("\n");
}

describe("registry index schema", () => {
  test("accepts the built index", () => {
    expect(issuesOf(loadIndex())).toBe("");
  });

  test("rejects an index whose release is not among its releases", () => {
    expect(issuesOf({ ...loadIndex(), release: "9999.01.01" })).toContain(
      'release "9999.01.01" is not one of the listed releases',
    );
  });

  test("rejects a Module whose latest version is not listed", () => {
    const index = loadIndex();
    const { name, entry } = firstModule(index);
    const broken = {
      ...index,
      modules: { ...index.modules, [name]: { ...entry, latest: "99.0.0" } },
    };
    expect(issuesOf(broken)).toContain('latest "99.0.0" is not one of the listed versions');
  });

  test("rejects a Module whose latest version is Yanked", () => {
    const index = loadIndex();
    const { name, entry } = firstModule(index);
    const latest = entry.versions[entry.latest];
    if (latest === undefined) throw new Error("the latest version is not listed");
    const versions = { ...entry.versions, [entry.latest]: { ...latest, yanked: true } };
    const broken = { ...index, modules: { ...index.modules, [name]: { ...entry, versions } } };
    expect(issuesOf(broken)).toContain("is a Yanked version");
  });
});
