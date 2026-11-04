import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyDrift } from "../../src/drift/classify.ts";
import { hashTrackedFile } from "../../src/drift/hash.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";

const region = (body: string): string =>
  `<!-- aokit:begin hono:agents -->\n${body}\n<!-- aokit:end hono:agents -->`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function projectWith(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aokit-classify-"));
  directories.push(dir);
  await writeFile(join(dir, "AGENTS.md"), content, "utf8");
  return dir;
}

function lockfileFor(content: string): Lockfile {
  const hash = hashTrackedFile("AGENTS.md", new TextEncoder().encode(content));
  return {
    $schema: "https://aokit.andryore.dev/schema/lockfile/v2.json",
    lockfileVersion: 2,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: {},
    modules: {},
    files: { "AGENTS.md": { owners: ["hono"], mode: "managed", hash } },
    deps: {},
  };
}

test("doctor reads a Region file as pristine when only text outside markers changed", async () => {
  const written = `${region("uses hono")}\n`;
  const dir = await projectWith(`my notes\n\n${written}\nmore notes\n`);
  const report = await classifyDrift(dir, lockfileFor(written));
  expect(report.files.find((entry) => entry.path === "AGENTS.md")?.state).toBe("pristine");
});

test("doctor reads a Region file as modified after an edit inside a Region", async () => {
  const written = `${region("uses hono")}\n`;
  const dir = await projectWith(`${region("edited by hand")}\n`);
  const report = await classifyDrift(dir, lockfileFor(written));
  expect(report.files.find((entry) => entry.path === "AGENTS.md")?.state).toBe("modified");
});
