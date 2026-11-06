import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { removeCommand } from "../../src/cli/commands/remove.ts";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { runGitChecked } from "../../src/git/run.ts";
import { parseLockfile } from "../../src/lockfile/index.ts";
import { serializeLockfile } from "../../src/lockfile/serialize.ts";
import { objectAt, parseJsonObject } from "../helpers/update-json.ts";

const context = { version: cliVersion, env: {}, commands: [] };
const workspace = mkdtempSync(join(tmpdir(), "aokit-remove-"));
let counter = 0;

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

type Layout = "single" | "monorepo";

async function create(modules: string[], layout: Layout): Promise<string> {
  counter += 1;
  const directory = join(workspace, `app-${counter}`);
  const envelope = await runCommand(createCommand, context, {
    directory,
    layout,
    modules: modules.join(","),
    yes: true,
    install: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  return directory;
}

async function createWithOrphan(): Promise<string> {
  const directory = await create(["coolify", "docker", "oxc"], "single");
  const lock = await lockOf(directory);
  const docker = lock.modules["docker"];
  if (docker === undefined) throw new Error("docker is not in the Lockfile");
  const edited = { ...lock, modules: { ...lock.modules, docker: { ...docker, selected: false } } };
  await writeFile(join(directory, "aokit.lock.json"), serializeLockfile(edited));
  return directory;
}

function remove(directory: string, module: string, extra: Record<string, unknown> = {}) {
  return runCommand(removeCommand, context, {
    module,
    directory,
    yes: true,
    install: false,
    allowDirty: true,
    ...extra,
  });
}

async function tree(directory: string, prefix = ""): Promise<Record<string, string>> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const parts = await Promise.all(
    entries
      .filter((entry) => entry.name !== "node_modules" && entry.name !== ".git")
      .map(async (entry): Promise<Record<string, string>> => {
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        return entry.isDirectory()
          ? tree(directory, path)
          : { [path]: await readFile(join(directory, path), "utf8") };
      }),
  );
  const merged: Record<string, string> = {};
  for (const part of parts) Object.assign(merged, part);
  return merged;
}

async function lockOf(directory: string) {
  return parseLockfile(await readFile(join(directory, "aokit.lock.json"), "utf8")).lockfile;
}

async function commitAll(directory: string): Promise<void> {
  const config = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];
  await runGitChecked(directory, ["init", "-q"]);
  await runGitChecked(directory, [...config, "add", "-A"]);
  await runGitChecked(directory, [...config, "commit", "-q", "-m", "init"]);
}

const selections = [
  ["oxc", "vite-react", "knip", "tailwind4"],
  ["oxc", "hono", "docker", "coolify"],
  ["oxc", "vite-react", "hono", "docker"],
];
const layouts: Layout[] = ["single", "monorepo"];

describe("remove --cascade --yes on an unedited Project", () => {
  for (const layout of layouts) {
    for (const selection of selections) {
      for (const module of selection) {
        test(`${layout} ${selection.join(",")} minus ${module}`, async () => {
          const directory = await create(selection, layout);
          const envelope = await remove(directory, module, { cascade: true });
          expect(envelope.ok).toBe(true);
          const removed = removeCommand.output.parse(envelope.data).removed;
          expect(removed).toContain(module);
          const rest = selection.filter((name) => !removed.includes(name));
          const fresh = await create(rest, layout);
          expect(await tree(directory)).toEqual(await tree(fresh));
          const doctor = await runCommand(doctorCommand, context, { directory });
          expect(doctor.ok).toBe(true);
          const lock = await lockOf(directory);
          expect(Object.keys(lock.modules)).toEqual(Object.keys((await lockOf(fresh)).modules));
        });
      }
    }
  }
});

test("dependents without --cascade fail with DEPENDENTS_EXIST and write nothing", async () => {
  const directory = await create(["oxc", "hono", "docker", "coolify"], "single");
  const before = await tree(directory);
  const envelope = await remove(directory, "docker");
  expect(envelope.ok).toBe(false);
  if (envelope.ok) return;
  expect(envelope.error.code).toBe("DEPENDENTS_EXIST");
  expect(envelope.error.message).toContain("coolify");
  expect(exitCodeForEnvelope(envelope)).toBe(4);
  expect(await tree(directory)).toEqual(before);
});

test("a Module that is not selected fails with NOT_SELECTED", async () => {
  const directory = await createWithOrphan();
  const lock = await lockOf(directory);
  expect(lock.modules["docker"]?.selected).toBe(false);
  const envelope = await remove(directory, "docker");
  expect(envelope.ok).toBe(false);
  if (envelope.ok) return;
  expect(envelope.error.code).toBe("NOT_SELECTED");
  expect(exitCodeForEnvelope(envelope)).toBe(3);
});

test("removing the last requirer leaves an orphan that needs --yes", async () => {
  const directory = await createWithOrphan();
  const withoutYes = await remove(directory, "coolify", { yes: false });
  expect(withoutYes.ok).toBe(false);
  if (withoutYes.ok) return;
  expect(withoutYes.error.code).toBe("MISSING_VALUE");
  expect(withoutYes.error.message).toContain("docker");
  expect(exitCodeForEnvelope(withoutYes)).toBe(3);
  const withYes = await remove(directory, "coolify");
  expect(withYes.ok).toBe(true);
  expect(Object.keys((await lockOf(directory)).modules)).toEqual(["oxc"]);
});

test("--dry-run and --diff write nothing", async () => {
  const directory = await create(["oxc", "vite-react", "knip"], "single");
  const before = await tree(directory);
  const dry = await remove(directory, "knip", { dryRun: true });
  expect(dry.ok).toBe(true);
  const diffed = await remove(directory, "knip", { diff: true });
  expect(diffed.ok).toBe(true);
  expect(removeCommand.output.parse(diffed.data).diff).toContain("@@");
  expect(await tree(directory)).toEqual(before);
});

test("a user-edited managed file is kept with a warning and leaves the Lockfile owners", async () => {
  const directory = await create(["oxc", "vite-react", "knip"], "single");
  const lock = await lockOf(directory);
  const owned = Object.entries(lock.files).find(
    ([, entry]) =>
      entry.mode === "managed" && entry.owners.length === 1 && entry.owners[0] === "knip",
  );
  expect(owned).toBeDefined();
  const path = owned?.[0] ?? "";
  await writeFile(join(directory, path), "edited by the user\n");
  const envelope = await remove(directory, "knip");
  expect(envelope.ok).toBe(true);
  expect(await readFile(join(directory, path), "utf8")).toBe("edited by the user\n");
  expect(removeCommand.output.parse(envelope.data).warnings.join("\n")).toContain(path);
  expect((await lockOf(directory)).files[path]).toBeUndefined();
});

test("--allow-dirty is required on a dirty tree", async () => {
  const directory = await create(["oxc", "vite-react", "knip"], "single");
  await commitAll(directory);
  await writeFile(join(directory, "notes.txt"), "x\n");
  const refused = await remove(directory, "knip", { allowDirty: false });
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.error.code).toBe("DIRTY_TREE");
  expect(exitCodeForEnvelope(refused)).toBe(5);
  expect((await remove(directory, "knip", { allowDirty: true })).ok).toBe(true);
});

test("a user-edited seed file is kept with a warning and no Conflict", async () => {
  const directory = await create(["oxc", "vite-react", "knip"], "single");
  const lock = await lockOf(directory);
  const seed = Object.entries(lock.files).find(
    ([, entry]) =>
      entry.mode === "seed" && entry.owners.length === 1 && entry.owners[0] === "vite-react",
  );
  expect(seed).toBeDefined();
  const path = seed?.[0] ?? "";
  await writeFile(join(directory, path), "my seed\n");
  const envelope = await remove(directory, "vite-react", { cascade: true });
  expect(envelope.ok).toBe(true);
  expect(await readFile(join(directory, path), "utf8")).toBe("my seed\n");
  if (envelope.ok) {
    expect(
      removeCommand.output.parse(envelope.data).warnings.some((warning) => warning.includes(path)),
    ).toBe(true);
  }
});

test("a Conflict after removal exits 6 and keeps the conflicted Lockfile hash", async () => {
  const directory = await create(["oxc", "knip"], "single");
  const manifestPath = join(directory, "package.json");
  const manifest = parseJsonObject(await readFile(manifestPath, "utf8"));
  objectAt(manifest, "scripts")["knip"] = "my own knip";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await commitAll(directory);
  const before = await lockOf(directory);
  const envelope = await remove(directory, "knip", { allowDirty: false });
  expect(envelope.ok).toBe(false);
  if (envelope.ok) return;
  expect(envelope.error.code).toBe("MERGE_CONFLICTS");
  expect(exitCodeForEnvelope(envelope)).toBe(6);
  expect((await lockOf(directory)).files["package.json"]?.hash).toBe(
    before.files["package.json"]?.hash,
  );
});
