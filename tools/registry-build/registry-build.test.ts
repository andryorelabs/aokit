import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogSchema } from "@aokit/module";
import { buildRegistry, listFiles } from "./build.ts";
import { diffDirectories } from "./diff.ts";
import { writeRegistrySourceFixture } from "./fixture.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "aokit-registry-out-"));
  temporaryDirectories.push(path);
  return path;
}

async function fixtureSource(): Promise<string> {
  const path = await writeRegistrySourceFixture();
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("registry:build writes the registry.md layout with sorted index and integrity", async () => {
  const source = await fixtureSource();
  const out = await temporaryDirectory();
  await buildRegistry(source, out);

  expect(await listFiles(out)).toEqual([
    "catalog/2026.11.0.json",
    "index.json",
    "modules/knip/2.1.0.json",
    "modules/oxc/1.0.0.json",
    "modules/oxc/1.0.0/files/.oxlintrc.json",
    "modules/oxc/1.0.0/files/nested/notes.md",
  ]);
  const indexText = await readFile(join(out, "index.json"), "utf8");
  const index = JSON.parse(indexText);
  expect(index).toMatchObject({
    name: "official",
    release: "2026.11.0",
    minCliVersion: "0.1.0",
    schemaVersion: 1,
    catalog: { path: "catalog/2026.11.0.json" },
  });
  expect(Object.keys(index.modules)).toEqual(["knip", "oxc"]);
  expect(index.modules.oxc.latest).toBe("1.0.0");
  expect(index.modules.oxc.versions["1.0.0"].provides).toEqual(["lint", "format"]);
  expect(Object.keys(index.modules.oxc.versions["1.0.0"].files)).toEqual([
    "files/.oxlintrc.json",
    "files/nested/notes.md",
  ]);
  expect(indexText).not.toContain("\r");
  expect(await readFile(join(out, "modules/oxc/1.0.0/files/.oxlintrc.json"), "utf8")).toBe(
    '{\n  "ignorePatterns": []\n}\n',
  );
});

test("registry:build is deterministic: two runs produce byte-identical output", async () => {
  const source = await fixtureSource();
  const first = await temporaryDirectory();
  const second = await temporaryDirectory();
  await buildRegistry(source, first);
  await buildRegistry(source, second);
  expect(await diffDirectories(first, second)).toEqual([]);
});

test("registry:build replaces stale output", async () => {
  const source = await fixtureSource();
  const out = await temporaryDirectory();
  await writeFile(join(out, "stale.json"), "{}\n", "utf8");
  await buildRegistry(source, out);
  expect(await listFiles(out)).not.toContain("stale.json");
});

test("registry:build refuses a manifest file missing from files/", async () => {
  const source = await fixtureSource();
  await rm(join(source, "oxc/files/nested/notes.md"));
  const out = await temporaryDirectory();
  const failure = await buildRegistry(source, out).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("files/nested/notes.md");
});

test("the drift check names the path an unbuilt source edit changes", async () => {
  const source = await fixtureSource();
  const committed = await temporaryDirectory();
  await buildRegistry(source, committed);
  await writeFile(join(source, "oxc/files/.oxlintrc.json"), '{ "ignorePatterns": ["x"] }\n');
  const fresh = await temporaryDirectory();
  await buildRegistry(source, fresh);
  expect(await diffDirectories(fresh, committed)).toEqual([
    "index.json",
    "modules/oxc/1.0.0/files/.oxlintrc.json",
  ]);
});

test("registry/ matches a fresh build of registry-src/ (run `bun run registry:build`)", async () => {
  const fresh = await temporaryDirectory();
  await buildRegistry(join(repoRoot, "registry-src"), fresh);
  const drifted = await diffDirectories(fresh, join(repoRoot, "registry"));
  expect(
    drifted,
    `registry/ is stale; run \`bun run registry:build\`. Differing paths: ${drifted.join(", ")}`,
  ).toEqual([]);
});

test("the 2026.11.0 Catalog lists every curated Module dependency with oxc pinned", async () => {
  const text = await readFile(join(repoRoot, "registry-src/catalog/2026.11.0.json"), "utf8");
  const catalog = catalogSchema.parse(JSON.parse(text));
  expect(catalog.release).toBe("2026.11.0");
  expect(Object.keys(catalog.dependencies).toSorted()).toEqual(
    [
      "oxlint",
      "oxfmt",
      "knip",
      "vite",
      "@vitejs/plugin-react",
      "react",
      "react-dom",
      "@types/react",
      "@types/react-dom",
      "typescript",
      "tailwindcss",
      "@tailwindcss/vite",
      "hono",
      "@types/bun",
    ].toSorted(),
  );
  expect(catalog.pinGroups).toEqual({ oxc: ["oxlint", "oxfmt"] });
  for (const member of catalog.pinGroups["oxc"] ?? []) {
    expect(catalog.dependencies[member]).toMatch(/^\d+\.\d+\.\d+$/);
  }
});
