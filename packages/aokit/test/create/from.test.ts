import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { cliVersion } from "../../src/cli/version.ts";
import {
  builtRegistry,
  cleanTemporaryDirectories,
  createProject as createFixtureProject,
  temporaryDirectory,
} from "../diff/support.ts";

const root = mkdtempSync(join(tmpdir(), "aokit-from-"));
const context = { version: cliVersion, env: {}, commands: [] };

afterAll(async () => {
  await cleanTemporaryDirectories();
  rmSync(root, { recursive: true, force: true });
});

function create(input: Record<string, unknown>) {
  return runCommand(createCommand, context, { yes: true, install: false, ...input });
}

function uniqueDirectory(prefix: string): string {
  return join(root, `${prefix}-${Math.random().toString(36).slice(2)}`);
}

async function tree(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .map((path) => [path.slice(directory.length), readFileSync(path, "utf8")] as const),
  );
}

async function source(layout: "single" | "monorepo" = "single") {
  const directory = uniqueDirectory("a");
  const envelope = await create({ directory, modules: "oxc,vite-react,knip", layout });
  expect(envelope.ok).toBe(true);
  return directory;
}

test.each(["single", "monorepo"] as const)(
  "create --from reproduces the tree and the Lockfile (%s)",
  async (layout) => {
    const a = await source(layout);
    const b = uniqueDirectory("b");
    const envelope = await create({ directory: b, from: join(a, "aokit.lock.json") });
    expect(envelope.ok).toBe(true);
    expect(await tree(b)).toEqual(await tree(a));
    expect(readFileSync(join(b, "aokit.lock.json"), "utf8")).toBe(
      readFileSync(join(a, "aokit.lock.json"), "utf8"),
    );
  },
);

test("an answer flag overrides only that answer", async () => {
  const fixtureRegistry = await builtRegistry(async (sourceRoot) => {
    const path = join(sourceRoot, "oxc", "module.ts");
    const text = await Bun.file(path).text();
    await Bun.write(
      path,
      text.replace(
        'provides: ["lint", "format"],',
        'provides: ["lint", "format"], answers: { strict: { type: "boolean", default: false }, label: { type: "string", default: "x" } },',
      ),
    );
  });
  const a = await createFixtureProject(fixtureRegistry);
  const b = join(await temporaryDirectory(), "b");
  const envelope = await create({
    directory: b,
    from: join(a, "aokit.lock.json"),
    answer: ["oxc.strict=true"],
  });
  expect(envelope.ok).toBe(true);
  const original = JSON.parse(readFileSync(join(a, "aokit.lock.json"), "utf8"));
  const created = JSON.parse(readFileSync(join(b, "aokit.lock.json"), "utf8"));
  expect(original.modules.oxc.answers).toEqual({ strict: false, label: "x" });
  expect(created.modules.oxc.answers).toEqual({ strict: true, label: "x" });
  expect(created.modules.oxc.version).toBe(original.modules.oxc.version);
});

test("a Module selection flag with --from is a usage error", async () => {
  const a = await source();
  const envelope = await create({
    directory: uniqueDirectory("b"),
    from: join(a, "aokit.lock.json"),
    modules: "oxc@0.0.1",
  });
  expect(envelope.ok).toBe(false);
  if (!envelope.ok) expect(envelope.error.code).toBe("INVALID_INPUT");
});

test("a URL source is a usage error pointing to the local path", async () => {
  const envelope = await create({
    directory: uniqueDirectory("b"),
    from: "https://example.com/aokit.lock.json",
  });
  expect(envelope.ok).toBe(false);
  if (envelope.ok) return;
  expect(envelope.error.code).toBe("INVALID_INPUT");
  expect(envelope.error.fix).toContain("local path");
});

test("a Lockfile whose integrity does not match the Registry fails", async () => {
  const a = await source();
  const path = join(a, "aokit.lock.json");
  const lock = JSON.parse(readFileSync(path, "utf8"));
  lock.modules.oxc.integrity = `sha256-${"0".repeat(64)}`;
  await Bun.write(path, JSON.stringify(lock, null, 2));
  const envelope = await create({ directory: uniqueDirectory("b"), from: path });
  expect(envelope.ok).toBe(false);
  if (!envelope.ok) expect(envelope.error.message).toContain("REGISTRY_INTEGRITY_MISMATCH");
});
