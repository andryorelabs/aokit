import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@aokit/module";
import { buildRegistry } from "../../../../tools/registry-build/build.ts";
import { writeRegistrySourceFixture } from "../../../../tools/registry-build/fixture.ts";
import type { Vfs } from "../../src/engine/index.ts";
import { buildProject } from "../../src/pipeline/index.ts";
import { createProject, readText, removeModule, writeText } from "../agent-files/support.ts";
import { input } from "../pipeline/fixtures.ts";

const gitignoreRegion = (name: string): string => `
    {
      op: "appendRegion",
      target: "root",
      file: ".gitignore",
      region: "ignore",
      content: "${name}-output/",
    },`;

function moduleSource(name: string, version: string, extra: string): string {
  return `export default {
  name: "${name}",
  version: "${version}",
  description: "Fixture Module.",
  ${extra}
  ops: [${gitignoreRegion(name)}
  ],
};
`;
}

let registry = "";
const registryRoots: string[] = [];

beforeAll(async () => {
  const source = await writeRegistrySourceFixture();
  registry = mkdtempSync(join(tmpdir(), "aokit-text-regions-registry-"));
  registryRoots.push(registry);
  await Promise.all([
    writeFile(
      join(source, "oxc/module.ts"),
      moduleSource(
        "oxc",
        "1.0.0",
        `provides: ["lint", "format"], files: [{ from: "files/.oxlintrc.json", to: ".oxlintrc.json", target: "config" }],`,
      ),
    ),
    writeFile(
      join(source, "knip/module.ts"),
      moduleSource("knip", "2.1.0", `provides: ["unused-code"], requires: ["lint"],`),
    ),
  ]);
  await buildRegistry(source, registry);
  await rm(source, { recursive: true, force: true });
});

afterAll(async () => {
  await Promise.all(registryRoots.map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * S3 end to end: two Modules append Regions to `.gitignore` through the real `create` and
 * `remove` commands. Covers canonical order and removal of one Region on an untouched file.
 */
test("two Modules append Regions to .gitignore and remove drops only its own", async () => {
  const directory = await createProject(registry, "oxc,knip");
  const created = await readText(directory, ".gitignore");
  const begins = [...created.matchAll(/^# aokit:begin (\S+)$/gm)].map((match) => match[1]);
  expect(begins).toEqual(["oxc:ignore", "knip:ignore"]);

  const removed = await removeModule(directory, "knip");
  expect(removed.ok ? "ok" : removed.error.message).toBe("ok");
  const after = await readText(directory, ".gitignore");
  expect(after).toBe("# aokit:begin oxc:ignore\noxc-output/\n# aokit:end oxc:ignore\n");
});

/**
 * Documents the ADR-0020 boundary: Region-aware merge covers only `AGENTS.md` and `CLAUDE.md`
 * (`isRegionFile`), so removing a Module from a user-edited `.gitignore` is merged as plain text
 * and reports a Conflict instead of splicing the Region. Revisit when Region-aware merge is
 * extended to other text files.
 */
test("remove reports a Conflict for a user-edited .gitignore, as plain text", async () => {
  const directory = await createProject(registry, "oxc,knip");
  const created = await readText(directory, ".gitignore");
  await writeText(directory, ".gitignore", `my-local-notes/\n${created}.env.local\n`);
  const removed = await removeModule(directory, "knip");
  expect(removed.ok ? "ok" : removed.error.message).toContain(".gitignore");
});

const writer = (target: string) => ({
  manifest: parseManifest({
    name: `${target}-app`,
    version: "1.0.0",
    description: "Fixture Module.",
    files: [{ from: "package.json", to: "package.json", target }],
  }),
  readFile: () => `{\n  "name": "${target}-app",\n  "version": "0.0.0"\n}\n`,
});

async function build(layout: "single" | "monorepo", target: string) {
  const result = await buildProject(
    input({ selection: [`${target}-app`], available: [writer(target)], layout }),
  );
  if (!result.ok) throw new Error("pipeline failed");
  return result.plan.vfs;
}

function workspacesOf(vfs: Vfs): string[] {
  const text = vfs.read("package.json");
  if (typeof text !== "string") return [];
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("workspaces" in parsed)) return [];
  const { workspaces } = parsed;
  return Array.isArray(workspaces) ? workspaces.map(String) : [];
}

test("a Module writing to extension lands under apps/extension in a monorepo", async () => {
  const vfs = await build("monorepo", "extension");
  expect(vfs.read("apps/extension/package.json")).toContain('"extension-app"');
  expect(workspacesOf(vfs)).toContain("apps/extension");
});

test("a Module writing to lib lands under packages/lib in a monorepo", async () => {
  const vfs = await build("monorepo", "lib");
  expect(vfs.read("packages/lib/package.json")).toContain('"lib-app"');
});

test("a Module writing to extension lands under extension/ in a single Project", async () => {
  const vfs = await build("single", "extension");
  expect(vfs.read("extension/package.json")).toContain('"extension-app"');
  expect(workspacesOf(vfs).join(",")).not.toContain("extension");
});
