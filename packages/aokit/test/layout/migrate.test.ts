import { afterAll, describe, expect, test } from "bun:test";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { z } from "zod";
import { runCommand } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { layoutMigrateCommand } from "../../src/cli/commands/layout-migrate.ts";
import { updateCommand } from "../../src/cli/commands/update.ts";
import { openGit } from "../../src/git/index.ts";
import { readUpdateMarker } from "../../src/update/state.ts";
import { loadMigratableSets } from "../matrix/source.ts";
import { commitAll, context, git, newWorkspace, readLock } from "../restore/helpers.ts";

const workspace = newWorkspace();

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const full = ["oxc", "vite-react", "hono", "knip"];
const frontend = ["oxc", "vite-react", "knip"];
const selections: readonly (readonly string[])[] = [
  full,
  frontend,
  ["hono", "oxc"],
  ["docker", "hono", "oxc", "vite-react"],
];

const migrateDataSchema = z.object({
  applied: z.boolean(),
  changed: z.boolean(),
  aborted: z.boolean(),
  conflicts: z.array(z.object({ path: z.string() })),
  warnings: z.array(z.string()),
  plan: z.object({
    changes: z.array(z.object({ type: z.string(), renamedFrom: z.string().nullable() })),
  }),
});

type MigrateData = z.output<typeof migrateDataSchema>;

type Layout = "single" | "monorepo";

let counter = 0;

function nextDirectory(): string {
  counter += 1;
  return join(workspace, `app-${counter}`);
}

async function create(layout: Layout, modules: readonly string[]): Promise<string> {
  const directory = nextDirectory();
  const envelope = await runCommand(createCommand, context, {
    directory,
    layout,
    modules: modules.join(","),
    yes: true,
    install: false,
    git: false,
  });
  if (!envelope.ok) throw new Error(envelope.error.message);
  return directory;
}

type MigrateOutcome =
  | { readonly ok: true; readonly data: MigrateData }
  | {
      readonly ok: false;
      readonly data: unknown;
      readonly error: { readonly code: string; readonly message: string };
    };

async function migrate(directory: string, args: Record<string, unknown>): Promise<MigrateOutcome> {
  const envelope = await runCommand(layoutMigrateCommand, context, {
    directory,
    yes: true,
    ...args,
  });
  return envelope.ok
    ? { ok: true, data: migrateDataSchema.parse(envelope.data) }
    : { ok: false, data: envelope.data, error: envelope.error };
}

async function treeOf(directory: string): Promise<Record<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const parent = relative(directory, entry.parentPath).split(sep).join("/");
    const path = posix.join(parent, entry.name);
    if (
      !entry.isFile() ||
      path.startsWith(".git/") ||
      path === "README.md" ||
      path.includes("node_modules/")
    )
      continue;
    // oxlint-disable-next-line eslint/no-await-in-loop -- reads a small fixture tree in order
    files[path] = await readFile(join(directory, path), "utf8");
  }
  return files;
}

async function lockSummary(directory: string) {
  const lockfile = await readLock(directory);
  return {
    layout: lockfile.layout,
    selected: Object.entries(lockfile.modules)
      .filter(([, entry]) => entry.selected)
      .map(([name]) => name)
      .toSorted(),
    files: lockfile.files,
  };
}

const renderCache = new Map<string, Promise<string>>();

/**
 * Renders a curated selection on a Layout once per test file; the result is both the source a
 * migration starts from (copied) and the fresh `create` a migrated tree is compared with.
 */
function renderedCurated(layout: Layout, modules: readonly string[]): Promise<string> {
  const key = `${layout} ${modules.join(",")}`;
  const cached = renderCache.get(key);
  if (cached !== undefined) return cached;
  const rendered = create(layout, modules);
  renderCache.set(key, rendered);
  return rendered;
}

async function committed(layout: Layout, modules: readonly string[]): Promise<string> {
  const directory = await create(layout, modules);
  await commitAll(directory);
  return directory;
}

async function commitEdits(directory: string): Promise<void> {
  await git(directory, "add", "-A");
  await git(directory, "commit", "-q", "-m", "edit");
}

async function conflicted() {
  const directory = await committed("single", full);
  await mkdir(join(directory, "apps/web"), { recursive: true });
  await writeFile(join(directory, "apps/web/tsconfig.json"), "user owned\n");
  await commitEdits(directory);
  const preMigration = await treeOf(directory);
  const envelope = await migrate(directory, { layout: "monorepo" });
  if (envelope.ok) throw new Error("expected MERGE_CONFLICTS");
  expect(envelope.error.code).toBe("MERGE_CONFLICTS");
  return { directory, preMigration };
}

function otherLayout(layout: Layout): Layout {
  return layout === "single" ? "monorepo" : "single";
}

describe("aokit layout migrate", () => {
  test("--dry-run --json prints rename changes and writes nothing", async () => {
    const directory = await committed("single", full);
    const before = await treeOf(directory);
    const envelope = await migrate(directory, { layout: "monorepo", yes: false, dryRun: true });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(envelope.data.applied).toBe(false);
    expect(envelope.data.changed).toBe(true);
    expect(envelope.data.plan.changes.some((change) => change.type === "rename")).toBe(true);
    expect(await treeOf(directory)).toEqual(before);
    expect(await git(directory, "status", "--short")).toBe("");
  });

  for (const from of ["single", "monorepo"] as const) {
    for (const selection of selections) {
      test(
        `${from} migration with no edits equals create --layout other (${selection.join(",")})`,
        async () => {
          const to = otherLayout(from);
          const directory = await committed(from, selection);
          const envelope = await migrate(directory, { layout: to });
          if (!envelope.ok) throw new Error(envelope.error.message);
          expect(envelope.data.conflicts).toEqual([]);
          const expected = await create(to, selection);
          const migrated = await treeOf(directory);
          const fresh = await treeOf(expected);
          expect(migrated).toEqual(fresh);
          expect(await lockSummary(directory)).toEqual(await lockSummary(expected));
        },
        { timeout: 60_000 },
      );
    }
  }

  for (const set of loadMigratableSets()) {
    for (const from of ["single", "monorepo"] as const) {
      test(
        `${from} migration of curated set ${set.slug} equals create --layout other`,
        async () => {
          const to = otherLayout(from);
          const directory = nextDirectory();
          await cp(await renderedCurated(from, set.modules), directory, { recursive: true });
          await commitAll(directory);
          const envelope = await migrate(directory, { layout: to });
          if (!envelope.ok) throw new Error(envelope.error.message);
          expect(envelope.data.conflicts).toEqual([]);
          const expected = await renderedCurated(to, set.modules);
          expect(await treeOf(directory)).toEqual(await treeOf(expected));
          expect(await lockSummary(directory)).toEqual(await lockSummary(expected));
        },
        { timeout: 60_000 },
      );
    }
  }

  test("moves a managed edit with its file and a seed edit unmerged", async () => {
    const directory = await committed("single", full);
    await writeFile(join(directory, "src/main.tsx"), "// managed edit\n", { flag: "a" });
    await writeFile(join(directory, "tsconfig.json"), "\n", { flag: "a" });
    const seedText = await readFile(join(directory, "tsconfig.json"), "utf8");
    await commitEdits(directory);
    const envelope = await migrate(directory, { layout: "monorepo" });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(envelope.data.conflicts).toEqual([]);
    expect(await readFile(join(directory, "apps/web/src/main.tsx"), "utf8")).toContain(
      "// managed edit",
    );
    expect(await readFile(join(directory, "apps/web/tsconfig.json"), "utf8")).toBe(seedText);
    expect(Object.keys(await treeOf(directory))).not.toContain("src/main.tsx");
    const lockfile = await readLock(directory);
    expect(lockfile.layout).toBe("monorepo");
    expect(lockfile.files["apps/web/tsconfig.json"]).toBeDefined();
  });

  test("leaves a user file in place and names it in a warning", async () => {
    const directory = await committed("single", full);
    await writeFile(join(directory, "src/notes.ts"), "export const note = 1;\n");
    await commitEdits(directory);
    const envelope = await migrate(directory, { layout: "monorepo" });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(await readFile(join(directory, "src/notes.ts"), "utf8")).toBe(
      "export const note = 1;\n",
    );
    expect(envelope.data.warnings.some((warning) => warning.includes("src/notes.ts"))).toBe(true);
  });

  test("migrating to the current Layout writes nothing", async () => {
    const directory = await committed("single", frontend);
    const envelope = await migrate(directory, { layout: "single" });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(envelope.data.changed).toBe(false);
    expect(envelope.data.applied).toBe(false);
    expect(await git(directory, "status", "--short")).toBe("");
  });

  test("a dirty tree fails with DIRTY_TREE unless --allow-dirty", async () => {
    const directory = await committed("single", frontend);
    await writeFile(join(directory, "scratch.txt"), "x\n");
    const refused = await migrate(directory, { layout: "monorepo" });
    if (refused.ok) throw new Error("expected DIRTY_TREE");
    expect(refused.error.code).toBe("DIRTY_TREE");
    const allowed = await migrate(directory, { layout: "monorepo", allowDirty: true });
    expect(allowed.ok).toBe(true);
  });

  test("a directory without a Lockfile fails with LOCKFILE_MISSING", async () => {
    const directory = nextDirectory();
    await mkdir(directory, { recursive: true });
    const envelope = await migrate(directory, { layout: "monorepo" });
    if (envelope.ok) throw new Error("expected LOCKFILE_MISSING");
    expect(envelope.error.code).toBe("LOCKFILE_MISSING");
  });

  test("a missing target Layout is INVALID_INPUT", async () => {
    const directory = await committed("single", frontend);
    const envelope = await migrate(directory, {});
    if (envelope.ok) throw new Error("expected INVALID_INPUT");
    expect(envelope.error.code).toBe("INVALID_INPUT");
  });

  for (const selection of selections) {
    test(
      `round trip keeps a managed and a seed edit with zero Conflicts (${selection.join(",")})`,
      async () => {
        const directory = await committed("single", selection);
        const lockfile = await readLock(directory);
        const owners = Object.entries(lockfile.files);
        const seedPath = owners.find(([, entry]) => entry.mode === "seed")?.[0];
        const managedPath = owners.find(
          ([path, entry]) =>
            entry.mode === "managed" && /\.(ts|tsx|md)$/.test(path) && !path.startsWith("."),
        )?.[0];
        if (managedPath === undefined) throw new Error("fixture selection has no managed file");
        await writeFile(join(directory, managedPath), "\n// managed edit\n", { flag: "a" });
        if (seedPath !== undefined) await writeFile(join(directory, seedPath), "\n", { flag: "a" });
        await commitEdits(directory);
        const original = await treeOf(directory);
        const there = await migrate(directory, { layout: "monorepo" });
        if (!there.ok) throw new Error(there.error.message);
        expect(there.data.conflicts).toEqual([]);
        await commitEdits(directory);
        const back = await migrate(directory, { layout: "single" });
        if (!back.ok) throw new Error(back.error.message);
        expect(back.data.conflicts).toEqual([]);
        expect(await treeOf(directory)).toEqual(original);
      },
      { timeout: 60_000 },
    );
  }

  test("a seed whose destination exists is a Conflict, not an overwrite", async () => {
    const directory = await committed("single", full);
    await mkdir(join(directory, "apps/web"), { recursive: true });
    await writeFile(join(directory, "apps/web/tsconfig.json"), "user owned\n");
    await commitEdits(directory);
    const envelope = await migrate(directory, { layout: "monorepo" });
    if (envelope.ok) throw new Error("expected MERGE_CONFLICTS");
    expect(envelope.error.code).toBe("MERGE_CONFLICTS");
    const conflicts = JSON.stringify(envelope.data);
    expect(conflicts).toContain("apps/web/tsconfig.json");
  });

  test("monorepo to single keeps a user tsconfig.json left in an emptied Target directory and warns", async () => {
    const directory = await committed("monorepo", full);
    await writeFile(join(directory, "apps/web/tsconfig.json"), "\n// web edit\n", { flag: "a" });
    await writeFile(join(directory, "apps/server/tsconfig.json"), "\n// server edit\n", {
      flag: "a",
    });
    await commitEdits(directory);
    const envelope = await migrate(directory, { layout: "single" });
    if (!envelope.ok) throw new Error(envelope.error.message);
    const webSide = await readFile(join(directory, "tsconfig.json"), "utf8");
    const serverSide = await readFile(join(directory, "apps/server/tsconfig.json"), "utf8");
    expect(webSide).toContain("// web edit");
    expect(webSide).not.toContain("// server edit");
    expect(serverSide).toContain("// server edit");
    const renamedFrom = envelope.data.plan.changes.map((change) => change.renamedFrom);
    expect(renamedFrom).not.toContain("apps/server/tsconfig.json");
    expect(envelope.data.warnings.join("\n")).toContain("apps/server/tsconfig.json");
  });

  describe("conflicts and abort", () => {
    test("writes a layout-migrate marker; update --abort refuses; migrate --abort restores", async () => {
      const { directory, preMigration } = await conflicted();
      const marker = await readUpdateMarker(directory, (await openGit(directory)) ?? undefined);
      expect(marker?.kind).toBe("layout-migrate");
      const refused = await runCommand(updateCommand, context, { directory, abort: true });
      if (refused.ok) throw new Error("expected INVALID_INPUT");
      expect(refused.error.code).toBe("INVALID_INPUT");
      expect(JSON.stringify(refused.error)).toContain("aokit layout migrate --abort");
      const aborted = await migrate(directory, { abort: true });
      if (!aborted.ok) throw new Error(aborted.error.message);
      expect(aborted.data.aborted).toBe(true);
      const restored = await treeOf(directory);
      expect(restored).toEqual(preMigration);
      expect((await readLock(directory)).layout).toBe("single");
    });
  });

  test("--abort with nothing to abort reports aborted false", async () => {
    const directory = await committed("single", frontend);
    const envelope = await migrate(directory, { abort: true });
    if (!envelope.ok) throw new Error(envelope.error.message);
    expect(envelope.data.aborted).toBe(false);
  });
});
