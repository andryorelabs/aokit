import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegistry } from "./build.ts";
import { diffDirectories } from "./diff.ts";
import { addMigrationToFixtureSource, writeRegistrySourceFixture } from "./fixture.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "aokit-registry-failure-out-"));
  temporaryDirectories.push(path);
  return path;
}

async function fixtureSource(): Promise<string> {
  const path = await writeRegistrySourceFixture();
  temporaryDirectories.push(path);
  return path;
}

async function failureOf(source: string, out: string): Promise<string> {
  return buildRegistry(source, out).then(
    () => "",
    (error: unknown) => String(error),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("an existing index.json that is not readable as a file fails the build", async () => {
  const out = await temporaryDirectory();
  await mkdir(join(out, "index.json"));
  expect(await failureOf(await fixtureSource(), out)).toContain("EISDIR");
});

test("an existing index.json that is not a Registry index fails and names the file", async () => {
  const out = await temporaryDirectory();
  await writeFile(join(out, "index.json"), JSON.stringify({ name: 3 }), "utf8");
  const failure = await failureOf(await fixtureSource(), out);
  expect(failure).toContain("registry:build cannot extend");
  expect(failure).toContain("Delete the registry directory to start over");
});

test("a Catalog whose release differs from its file name fails the build", async () => {
  const source = await fixtureSource();
  const path = join(source, "catalog/2026.11.0.json");
  await writeFile(
    path,
    JSON.stringify({ release: "2026.11.5", dependencies: { oxlint: "1.90.0" } }),
    "utf8",
  );
  const failure = await failureOf(source, await temporaryDirectory());
  expect(failure).toContain("has release 2026.11.5, expected 2026.11.0");
});

test("a source tree without any Catalog fails the build", async () => {
  const source = await fixtureSource();
  await rm(join(source, "catalog/2026.11.0.json"));
  expect(await failureOf(source, await temporaryDirectory())).toContain("found no Catalog");
});

test("a Module whose directory differs from its declared name fails the build", async () => {
  const source = await fixtureSource();
  const path = join(source, "knip/module.ts");
  await writeFile(path, (await readFile(path, "utf8")).replace('"knip"', '"other"'), "utf8");
  expect(await failureOf(source, await temporaryDirectory())).toContain(
    'declares name "other", expected "knip"',
  );
});

test("a Migration script that does not compile fails naming its source", async () => {
  const source = await fixtureSource();
  await addMigrationToFixtureSource(source);
  await writeFile(join(source, "oxc/migrations/1-to-2.before.ts"), "export default (", "utf8");
  expect(await failureOf(source, await temporaryDirectory())).not.toBe("");
});

test("a renames.json that cannot be read as a file fails the build", async () => {
  const source = await fixtureSource();
  await mkdir(join(source, "oxc/renames.json"));
  expect(await failureOf(source, await temporaryDirectory())).toContain("EISDIR");
});

test("a yanked.json entry that is not <module>@<version> fails the build", async () => {
  const source = await fixtureSource();
  await writeFile(join(source, "yanked.json"), JSON.stringify(["oxc"]), "utf8");
  expect(await failureOf(source, await temporaryDirectory())).toContain(
    'entry "oxc" is not <module>@<version>',
  );
});

test("yanking every version of a Module fails the build", async () => {
  const source = await fixtureSource();
  await writeFile(join(source, "yanked.json"), JSON.stringify(["oxc@1.0.0"]), "utf8");
  expect(await failureOf(source, await temporaryDirectory())).toContain(
    "every version of oxc is yanked",
  );
});

test("a directory that is missing from one side or differs is reported by the diff", async () => {
  const left = await temporaryDirectory();
  const right = await temporaryDirectory();
  await writeFile(join(left, "same.txt"), "a", "utf8");
  await writeFile(join(right, "same.txt"), "a", "utf8");
  await writeFile(join(left, "changed.txt"), "a", "utf8");
  await writeFile(join(right, "changed.txt"), "b", "utf8");
  await writeFile(join(left, "only-left.txt"), "a", "utf8");
  await writeFile(join(right, "only-right.txt"), "a", "utf8");
  expect(await diffDirectories(left, right)).toEqual([
    "changed.txt",
    "only-left.txt",
    "only-right.txt",
  ]);
});
