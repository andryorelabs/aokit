import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { catalogSchema } from "@aokit/module";
import { computeIntegrity } from "../../packages/aokit/src/registry/index.ts";
import { registryIndexSchema } from "../../packages/aokit/src/registry/schema.ts";
import { buildRegistry, listFiles } from "./build.ts";
import { diffDirectories } from "./diff.ts";
import { addMigrationToFixtureSource, writeRegistrySourceFixture } from "./fixture.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "aokit-registry-out-"));
  temporaryDirectories.push(path);
  return path;
}

async function readBuiltIndex(out: string) {
  return registryIndexSchema.parse(JSON.parse(await readFile(join(out, "index.json"), "utf8")));
}

async function readCatalogModules(path: string): Promise<unknown> {
  const catalog: unknown = JSON.parse(await readFile(path, "utf8"));
  return typeof catalog === "object" && catalog !== null && "modules" in catalog
    ? catalog.modules
    : undefined;
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
    "modules/knip/2.1.0/module.json",
    "modules/oxc/1.0.0/files/.oxlintrc.json",
    "modules/oxc/1.0.0/files/nested/notes.md",
    "modules/oxc/1.0.0/module.json",
  ]);
  const indexText = await readFile(join(out, "index.json"), "utf8");
  const rawIndex: unknown = JSON.parse(indexText);
  expect(rawIndex).toMatchObject({
    name: "official",
    release: "2026.11.0",
    minCliVersion: "0.1.0",
    schemaVersion: 1,
    releases: { "2026.11.0": { path: "catalog/2026.11.0.json" } },
  });
  const index = registryIndexSchema.parse(rawIndex);
  expect(Object.keys(index.modules)).toEqual(["knip", "oxc"]);
  expect(index.modules.oxc?.latest).toBe("1.0.0");
  expect(index.modules.oxc?.versions["1.0.0"]?.provides).toEqual(["lint", "format"]);
  expect(Object.keys(index.modules.oxc?.versions["1.0.0"]?.files ?? {})).toEqual([
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

test("registry:build never deletes what is already in the Registry", async () => {
  const source = await fixtureSource();
  const out = await temporaryDirectory();
  await writeFile(join(out, "keep.json"), "{}\n", "utf8");
  await buildRegistry(source, out);
  expect(await listFiles(out)).toContain("keep.json");
});

async function bumpedSource(edit: (moduleText: string) => string): Promise<string> {
  const source = await fixtureSource();
  const modulePath = join(source, "oxc/module.ts");
  await writeFile(modulePath, edit(await readFile(modulePath, "utf8")), "utf8");
  return source;
}

test("a bumped Module adds a version and keeps the published one byte for byte", async () => {
  const out = await temporaryDirectory();
  await buildRegistry(await fixtureSource(), out);
  const before = await readFile(join(out, "modules/oxc/1.0.0/module.json"), "utf8");
  await buildRegistry(
    await bumpedSource((text) => text.replace('version: "1.0.0"', 'version: "1.1.0"')),
    out,
  );
  const index = await readBuiltIndex(out);
  expect(Object.keys(index.modules.oxc?.versions ?? {})).toEqual(["1.0.0", "1.1.0"]);
  expect(index.modules.oxc?.latest).toBe("1.1.0");
  expect(index.modules.knip?.latest).toBe("2.1.0");
  expect(await readFile(join(out, "modules/oxc/1.0.0/module.json"), "utf8")).toBe(before);
  expect(await listFiles(out)).toContain("modules/oxc/1.1.0/files/.oxlintrc.json");
});

test("changing a published Module version without a bump fails naming oxc@1.0.0", async () => {
  const out = await temporaryDirectory();
  await buildRegistry(await fixtureSource(), out);
  const failure = await buildRegistry(
    await bumpedSource((text) => text.replace('"lint", "format"', '"lint"')),
    out,
  ).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("oxc@1.0.0");
  expect(await listFiles(out)).not.toContain("modules/oxc/1.1.0/module.json");
});

test("a new Release adds its own Catalog and an edited published Catalog fails", async () => {
  const out = await temporaryDirectory();
  await buildRegistry(await fixtureSource(), out);
  const next = await fixtureSource();
  await writeFile(
    join(next, "catalog/2026.12.0.json"),
    `${JSON.stringify({ release: "2026.12.0", dependencies: {} })}\n`,
    "utf8",
  );
  await buildRegistry(next, out);
  const index = await readBuiltIndex(out);
  expect(Object.keys(index.releases)).toEqual(["2026.11.0", "2026.12.0"]);
  expect(index.release).toBe("2026.12.0");

  const edited = await fixtureSource();
  await writeFile(
    join(edited, "catalog/2026.11.0.json"),
    `${JSON.stringify({ release: "2026.11.0", dependencies: {} })}\n`,
    "utf8",
  );
  const failure = await buildRegistry(edited, out).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(String(failure)).toContain("Release 2026.11.0");
});

test("each built Catalog carries the Module versions of its Release and a published one keeps them", async () => {
  const out = await temporaryDirectory();
  await buildRegistry(await fixtureSource(), out);
  const firstModules = await readCatalogModules(join(out, "catalog/2026.11.0.json"));
  expect(firstModules).toEqual({ knip: "2.1.0", oxc: "1.0.0" });

  const next = await fixtureSource();
  const modulePath = join(next, "oxc/module.ts");
  await writeFile(
    modulePath,
    (await readFile(modulePath, "utf8")).replace('version: "1.0.0"', 'version: "1.1.0"'),
    "utf8",
  );
  await writeFile(
    join(next, "catalog/2026.12.0.json"),
    `${JSON.stringify({ release: "2026.12.0", dependencies: {} })}\n`,
    "utf8",
  );
  await buildRegistry(next, out);
  const keptModules = await readCatalogModules(join(out, "catalog/2026.11.0.json"));
  const addedModules = await readCatalogModules(join(out, "catalog/2026.12.0.json"));
  expect(keptModules).toEqual({ knip: "2.1.0", oxc: "1.0.0" });
  expect(addedModules).toEqual({ knip: "2.1.0", oxc: "1.1.0" });
});

test("a Catalog source mapping a Module to a version no source builds fails the build", async () => {
  const source = await fixtureSource();
  await writeFile(
    join(source, "catalog/2026.11.0.json"),
    `${JSON.stringify({ release: "2026.11.0", dependencies: {}, modules: { oxc: "9.9.9" } })}\n`,
    "utf8",
  );
  const failure = await buildRegistry(source, await temporaryDirectory()).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(String(failure)).toContain("oxc to 9.9.9");
});

test("the old schema domain appears nowhere in the tree", () => {
  const retiredDomain = ["aokit", "dev"].join("\\.");
  const result = Bun.spawnSync(["git", "grep", "-n", retiredDomain], { cwd: repoRoot });
  expect(result.stdout.toString()).toBe("");
  expect(result.exitCode).toBe(1);
});

test("tsconfig.json typechecks Registry source files and Migration scripts", () => {
  const listed = Bun.spawnSync(
    ["node_modules/typescript7/bin/tsc", "--project", "tsconfig.json", "--listFilesOnly"],
    { cwd: repoRoot },
  );
  const files = listed.stdout.toString();
  expect(listed.exitCode).toBe(0);
  expect(files).toContain("registry-src/vite-react/migrations/routes-to-router.after.ts");
  expect(files).toMatch(/registry-src\/vite-react\/files\/.*\.tsx?\n/);
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

test("a Module shipping a Migration and renames.json lists both in files and integrity", async () => {
  const source = await fixtureSource();
  await addMigrationToFixtureSource(source);
  const out = await temporaryDirectory();
  await buildRegistry(source, out);

  const index = await readBuiltIndex(out);
  const version = index.modules.oxc?.versions["2.0.0"];
  expect(Object.keys(version?.files ?? {}).toSorted()).toEqual([
    "files/.oxlintrc.json",
    "files/nested/notes.md",
    "migrations/1-to-2.before.js",
    "renames.json",
  ]);
  const script = await readFile(join(out, "modules/oxc/2.0.0/migrations/1-to-2.before.js"), "utf8");
  expect(script).not.toContain("@aokit/module");
  expect(version?.files["migrations/1-to-2.before.js"]).toBe(computeIntegrity(script));
  expect(await listFiles(join(out, "modules/oxc/2.0.0"))).toContain("renames.json");
});

test("building a Migration is deterministic across source locations", async () => {
  const firstSource = await fixtureSource();
  const secondSource = await fixtureSource();
  await addMigrationToFixtureSource(firstSource);
  await addMigrationToFixtureSource(secondSource);
  const first = await temporaryDirectory();
  const second = await temporaryDirectory();
  await buildRegistry(firstSource, first);
  await buildRegistry(secondSource, second);
  expect(await diffDirectories(first, second)).toEqual([]);
});

test("a manifest migration without a compiled script fails the build", async () => {
  const source = await fixtureSource();
  await addMigrationToFixtureSource(source);
  await rm(join(source, "oxc/migrations/1-to-2.before.ts"));
  const failure = await buildRegistry(source, await temporaryDirectory()).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(String(failure)).toContain("migrations/1-to-2.before.js");
});

test("registry/ matches a fresh build of registry-src/ (run `bun run registry:build`)", async () => {
  const fresh = await temporaryDirectory();
  await cp(join(repoRoot, "registry"), fresh, { recursive: true });
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

async function buildFailure(source: string): Promise<string> {
  const failure = await buildRegistry(source, await temporaryDirectory()).then(
    () => undefined,
    (error: unknown) => error,
  );
  return String(failure);
}

async function addOxcFile(source: string, entry: string, extra?: [string, string]): Promise<void> {
  if (extra !== undefined) {
    await mkdir(dirname(join(source, "oxc", extra[0])), { recursive: true });
    await writeFile(join(source, "oxc", extra[0]), extra[1], "utf8");
  }
  const modulePath = join(source, "oxc/module.ts");
  const moduleText = await readFile(modulePath, "utf8");
  await writeFile(
    modulePath,
    moduleText.replace("  ],\n  deps", `    ${entry},\n  ],\n  deps`),
    "utf8",
  );
}

async function withSkill(skillText: string): Promise<string> {
  const source = await fixtureSource();
  await addOxcFile(
    source,
    '{ from: "files/skill/SKILL.md", to: ".claude/skills/my-skill/SKILL.md", target: "root" }',
    ["files/skill/SKILL.md", skillText],
  );
  return source;
}

test("a Module Skill with a valid name and description builds", async () => {
  const source = await withSkill("---\nname: my-skill\ndescription: Does a thing.\n---\n\nBody\n");
  const out = await temporaryDirectory();
  await buildRegistry(source, out);
  expect(await listFiles(out)).toContain("modules/oxc/1.0.0/files/skill/SKILL.md");
});

test("a Skill whose name differs from its directory fails naming the Module and path", async () => {
  const message = await buildFailure(
    await withSkill("---\nname: other\ndescription: Does a thing.\n---\n"),
  );
  expect(message).toContain(
    'registry:build: Module oxc skill my-skill: name must equal "my-skill"',
  );
  expect(message).toContain(".claude/skills/my-skill/SKILL.md");
});

test("a Skill with an empty description fails naming the Module", async () => {
  const message = await buildFailure(await withSkill("---\nname: my-skill\ndescription:\n---\n"));
  expect(message).toContain("Module oxc skill my-skill: description must not be empty");
});

test("a Skill with no frontmatter fails naming the Module", async () => {
  expect(await buildFailure(await withSkill("# no frontmatter\n"))).toContain(
    "Module oxc skill my-skill",
  );
});

test("a Module named aokit is rejected", async () => {
  const source = await fixtureSource();
  await mkdir(join(source, "aokit"), { recursive: true });
  await writeFile(
    join(source, "aokit/module.ts"),
    'export default {\n  name: "aokit",\n  version: "1.0.0",\n  provides: ["core"],\n};\n',
    "utf8",
  );
  const message = await buildFailure(source);
  expect(message).toContain("Module aokit");
  expect(message).toContain("reserved");
});

test.each(["AGENTS.md", "CLAUDE.md"])("a Module writing the root %s is rejected", async (path) => {
  const source = await fixtureSource();
  await addOxcFile(source, `{ from: "files/nested/notes.md", to: "${path}", target: "root" }`);
  const message = await buildFailure(source);
  expect(message).toContain("Module oxc");
  expect(message).toContain(path);
});

test.each([
  ["web", "AGENTS.md"],
  ["config", "CLAUDE.md"],
  ["root", "./AGENTS.md"],
])("a Module writing %s %s into the project root is rejected", async (target, path) => {
  const source = await fixtureSource();
  await addOxcFile(source, `{ from: "files/nested/notes.md", to: "${path}", target: "${target}" }`);
  const message = await buildFailure(source);
  expect(message).toContain("Module oxc");
  expect(message).toContain(path);
});

async function addPendingModule(source: string): Promise<void> {
  await mkdir(join(source, "pending"), { recursive: true });
  await writeFile(
    join(source, "pending", "module.ts"),
    `export default { name: "pending", version: "0.1.0", provides: ["pending-thing"] };\n`,
    "utf8",
  );
  await writeFile(
    join(source, "pending", "catalog.json"),
    `${JSON.stringify({ dependencies: { zod: "^4.0.0" } })}\n`,
    "utf8",
  );
}

test("a Pending Module is skipped so the built Registry stays byte-identical", async () => {
  const source = await fixtureSource();
  const baseline = await temporaryDirectory();
  await buildRegistry(source, baseline);
  await addPendingModule(source);
  const out = await temporaryDirectory();
  await cp(baseline, out, { recursive: true });
  await buildRegistry(source, out);
  expect(await diffDirectories(out, baseline)).toEqual([]);
});

test("registry/ is unchanged when a Pending Module sits in registry-src", async () => {
  const scratch = await mkdtemp(join(repoRoot, "node_modules", ".aokit-pending-"));
  temporaryDirectories.push(scratch);
  const source = join(scratch, "registry-src");
  await cp(join(repoRoot, "registry-src"), source, { recursive: true });
  await addPendingModule(source);
  const out = await temporaryDirectory();
  await cp(join(repoRoot, "registry"), out, { recursive: true });
  await buildRegistry(source, out);
  expect(await diffDirectories(out, join(repoRoot, "registry"))).toEqual([]);
});

test("includePending builds the Pending Module and a draft Release with the composed Catalog", async () => {
  const source = await fixtureSource();
  await addPendingModule(source);
  const out = await temporaryDirectory();
  await buildRegistry(source, out, { includePending: true });
  const index = await readBuiltIndex(out);
  expect(Object.keys(index.modules)).toEqual(["knip", "oxc", "pending"]);
  expect(index.release).toBe("2026.11.1");
  const draft: unknown = JSON.parse(await readFile(join(out, "catalog/2026.11.1.json"), "utf8"));
  expect(draft).toMatchObject({
    dependencies: { oxlint: "1.90.0", zod: "^4.0.0" },
    modules: { pending: "0.1.0" },
  });
});

test("includePending without a Pending Module adds no draft Release", async () => {
  const source = await fixtureSource();
  const out = await temporaryDirectory();
  await buildRegistry(source, out, { includePending: true });
  expect(Object.keys((await readBuiltIndex(out)).releases)).toEqual(["2026.11.0"]);
});

test("a published Module with a leftover catalog.json is still built", async () => {
  const source = await fixtureSource();
  const out = await temporaryDirectory();
  await buildRegistry(source, out);
  await writeFile(join(source, "oxc", "catalog.json"), `{"dependencies":{}}\n`, "utf8");
  await buildRegistry(source, out);
  expect(Object.keys((await readBuiltIndex(out)).modules)).toEqual(["knip", "oxc"]);
});
