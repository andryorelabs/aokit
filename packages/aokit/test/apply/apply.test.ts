import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplyError, apply, lockfileName } from "../../src/apply/index.ts";
import { installSignalHandlers } from "../../src/cli/shutdown.ts";
import { Vfs } from "../../src/engine/index.ts";
import { diffVfs, hashVfs, type Plan } from "../../src/engine/plan.ts";
import { parseLockfile, serializeLockfile } from "../../src/lockfile/index.ts";

const lockfileFixture = join(
  import.meta.dir,
  "..",
  "lockfile",
  "fixtures",
  "example.canonical.lock",
);

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "aokit-apply-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function loadLockfile() {
  return parseLockfile(await readFile(lockfileFixture, "utf8")).lockfile;
}

function planFrom(base: Vfs, next: Vfs): Plan {
  return {
    changes: diffVfs(base, next, () => [{ module: "fixture", entry: { kind: "file", from: "x" } }]),
    hash: hashVfs(next),
    vfs: next,
  };
}

interface SnapshotEntry {
  readonly path: string;
  readonly mode: number;
  readonly bytes: string;
}

async function snapshot(directory: string): Promise<SnapshotEntry[]> {
  const listing = await readdir(directory, { recursive: true, withFileTypes: true });
  const entries = await Promise.all(
    listing.map(async (entry) => {
      const absolute = join(entry.parentPath, entry.name);
      const stats = await stat(absolute);
      return {
        path: absolute.slice(directory.length),
        mode: stats.mode,
        bytes: entry.isFile() ? (await readFile(absolute)).toString("base64") : "<dir>",
      };
    }),
  );
  return entries.toSorted((a, b) => (a.path < b.path ? -1 : 1));
}

async function siblingsOf(directory: string): Promise<string[]> {
  return (await readdir(directory)).toSorted();
}

async function existingProject(): Promise<{ directory: string; base: Vfs }> {
  const directory = join(workspace, "project");
  await mkdir(join(directory, "src", "old"), { recursive: true });
  await writeFile(join(directory, "README.md"), "# old\n");
  await writeFile(join(directory, "src", "keep.ts"), "export const keep = 1;\n");
  await writeFile(join(directory, "src", "old", "gone.ts"), "export const gone = 1;\n");
  await writeFile(join(directory, "src", "moved.ts"), "export const moved = 1;\n");
  await writeFile(join(directory, "run.sh"), "#!/bin/sh\necho old\n");
  await chmod(join(directory, "run.sh"), 0o755);
  await writeFile(join(directory, lockfileName), "{}\n");
  return { directory, base: await Vfs.fromDirectory(directory) };
}

function nextOf(base: Vfs): Vfs {
  const next = base.clone();
  next.write("README.md", "# new\n");
  next.delete("src/old/gone.ts");
  next.delete("src/moved.ts");
  next.write("lib/moved.ts", "export const moved = 1;\n");
  next.write("src/added.ts", "export const added = 1;\n");
  next.write("run.sh", "#!/bin/sh\necho new\n");
  return next;
}

test("a new Project appears only after the final rename, staged in a unique sibling", async () => {
  const lockfile = await loadLockfile();
  const next = Vfs.empty();
  next.write("package.json", "{}\n");
  next.write("src/index.ts", "export {};\n");
  const directory = join(workspace, "fresh");
  const stagingSeen: string[] = [];

  const result = await apply(planFrom(Vfs.empty(), next), lockfile, directory, {
    beforeCommit: async (staging) => {
      stagingSeen.push(staging);
      expect(await siblingsOf(workspace)).toEqual([staging.slice(workspace.length + 1)]);
      expect(staging.startsWith(join(workspace, ".fresh.aokit-tmp-"))).toBe(true);
      expect(await readFile(join(staging, "src", "index.ts"), "utf8")).toBe("export {};\n");
    },
  });

  expect(result.project).toBe("new");
  expect(stagingSeen).toHaveLength(1);
  expect(await siblingsOf(workspace)).toEqual(["fresh"]);
  expect(await readFile(join(directory, "package.json"), "utf8")).toBe("{}\n");
  expect(await readFile(join(directory, lockfileName), "utf8")).toBe(serializeLockfile(lockfile));
});

test("two applies use distinct temp directory names", async () => {
  const lockfile = await loadLockfile();
  const names: string[] = [];
  const directory = join(workspace, "project");
  const recordStaging = (staging: string): void => {
    names.push(staging);
  };
  const first = Vfs.empty();
  first.write("a.txt", "one");
  await apply(planFrom(Vfs.empty(), first), lockfile, directory, { beforeCommit: recordStaging });
  const base = await Vfs.fromDirectory(directory);
  const second = base.clone();
  second.write("a.txt", "two");
  await apply(planFrom(base, second), lockfile, directory, { beforeCommit: recordStaging });
  expect(names).toHaveLength(2);
  expect(new Set(names).size).toBe(2);
  expect(names.every((name) => name.startsWith(join(workspace, ".project.aokit-tmp-")))).toBe(true);
  expect(await readFile(join(directory, "a.txt"), "utf8")).toBe("two");
});

test("a missing parent directory fails before anything is written", async () => {
  const lockfile = await loadLockfile();
  const failure = await apply(
    planFrom(Vfs.empty(), Vfs.empty()),
    lockfile,
    join(workspace, "missing", "project"),
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApplyError);
  expect(failure).toMatchObject({ code: "IO_ERROR" });
  expect(await siblingsOf(workspace)).toEqual([]);
});

test("an existing Project gets create, update, delete and rename, Lockfile written last", async () => {
  const lockfile = await loadLockfile();
  const { directory, base } = await existingProject();
  const plan = planFrom(base, nextOf(base));
  expect(plan.changes.map((change) => change.type).toSorted()).toEqual([
    "create",
    "delete",
    "rename",
    "update",
    "update",
  ]);
  let lockfileBeforeCommit = "";

  const result = await apply(plan, lockfile, directory, {
    beforeCommit: async () => {
      lockfileBeforeCommit = await readFile(join(directory, lockfileName), "utf8");
    },
  });

  expect(result.project).toBe("existing");
  expect(lockfileBeforeCommit).toBe("{}\n");
  expect(await readFile(join(directory, "README.md"), "utf8")).toBe("# new\n");
  expect(await readFile(join(directory, "src", "added.ts"), "utf8")).toBe(
    "export const added = 1;\n",
  );
  expect(await readFile(join(directory, "lib", "moved.ts"), "utf8")).toBe(
    "export const moved = 1;\n",
  );
  expect(await readFile(join(directory, "src", "keep.ts"), "utf8")).toBe(
    "export const keep = 1;\n",
  );
  expect((await readdir(join(directory, "src"))).toSorted()).toEqual(["added.ts", "keep.ts"]);
  expect((await stat(join(directory, "run.sh"))).mode & 0o777).toBe(0o755);
  expect(await readFile(join(directory, lockfileName), "utf8")).toBe(serializeLockfile(lockfile));
  expect(await siblingsOf(workspace)).toEqual(["project"]);
});

test("the Lockfile is renamed after every Project file", async () => {
  const lockfile = await loadLockfile();
  const { directory, base } = await existingProject();
  await apply(planFrom(base, nextOf(base)), lockfile, directory);
  const lockfileTime = (await stat(join(directory, lockfileName))).ctimeMs;
  const fileTimes = await Promise.all(
    ["README.md", "src/added.ts", "lib/moved.ts"].map(
      async (path) => (await stat(join(directory, path))).ctimeMs,
    ),
  );
  expect(fileTimes.every((time) => time <= lockfileTime)).toBe(true);
});

test("a forced error before the final rename leaves an existing Project byte-identical", async () => {
  const lockfile = await loadLockfile();
  const { directory, base } = await existingProject();
  const before = await snapshot(directory);

  const failure = await apply(planFrom(base, nextOf(base)), lockfile, directory, {
    beforeCommit: () => {
      throw new Error("disk full");
    },
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(ApplyError);
  expect(failure).toMatchObject({ code: "IO_ERROR" });
  expect(await snapshot(directory)).toEqual(before);
  expect(await siblingsOf(workspace)).toEqual(["project"]);
});

test("a staging error for a new Project leaves no Project and no temp dir", async () => {
  const lockfile = await loadLockfile();
  const next = Vfs.empty();
  next.write("a", "file");
  next.write("a/b", "nested under a file");

  const failure = await apply(
    planFrom(Vfs.empty(), next),
    lockfile,
    join(workspace, "fresh"),
  ).catch((error: unknown) => error);

  expect(failure).toMatchObject({ code: "IO_ERROR" });
  expect(await siblingsOf(workspace)).toEqual([]);
});

test("a simulated SIGINT before the final rename exits 130 and changes nothing", async () => {
  const lockfile = await loadLockfile();
  const { directory, base } = await existingProject();
  const before = await snapshot(directory);
  const exitCodes: number[] = [];
  const { promise: exited, resolve: markExited } = Promise.withResolvers<void>();
  const uninstall = installSignalHandlers({
    exit: (code) => {
      exitCodes.push(code);
      markExited();
    },
  });

  try {
    const failure = await apply(planFrom(base, nextOf(base)), lockfile, directory, {
      beforeCommit: () => {
        process.emit("SIGINT");
      },
    }).catch((error: unknown) => error);
    await exited;

    expect(failure).toBeInstanceOf(ApplyError);
    expect(failure).toMatchObject({ code: "INTERRUPTED" });
    expect(exitCodes).toEqual([130]);
    expect(await snapshot(directory)).toEqual(before);
    expect(await siblingsOf(workspace)).toEqual(["project"]);
  } finally {
    uninstall();
  }
});

test("a simulated SIGINT while creating a new Project leaves nothing behind", async () => {
  const lockfile = await loadLockfile();
  const next = Vfs.empty();
  next.write("a.txt", "a");
  const exitCodes: number[] = [];
  const { promise: exited, resolve: markExited } = Promise.withResolvers<void>();
  const uninstall = installSignalHandlers({
    exit: (code) => {
      exitCodes.push(code);
      markExited();
    },
  });

  try {
    const pending = apply(planFrom(Vfs.empty(), next), lockfile, join(workspace, "fresh"));
    process.emit("SIGINT");
    const failure = await pending.catch((error: unknown) => error);
    await exited;

    expect(failure).toMatchObject({ code: "INTERRUPTED" });
    expect(exitCodes).toEqual([130]);
    expect(await siblingsOf(workspace)).toEqual([]);
  } finally {
    uninstall();
  }
});

test("the manifest mode is applied on write", async () => {
  const lockfile = await loadLockfile();
  const next = Vfs.empty();
  next.write("bin/run", "#!/bin/sh\n", { mode: "755" });
  next.write("secret", "s", { mode: "0600" });
  next.write("plain.txt", "p");
  const directory = join(workspace, "fresh");

  await apply(planFrom(Vfs.empty(), next), lockfile, directory);

  expect((await stat(join(directory, "bin", "run"))).mode & 0o7777).toBe(0o755);
  expect((await stat(join(directory, "secret"))).mode & 0o7777).toBe(0o600);

  const { base } = { base: await Vfs.fromDirectory(directory) };
  const updated = base.clone();
  updated.write("plain.txt", "changed", { mode: "700" });
  await apply(planFrom(base, updated), lockfile, directory);
  expect((await stat(join(directory, "plain.txt"))).mode & 0o7777).toBe(0o700);
});

test("a path that is a file fails without touching it", async () => {
  const lockfile = await loadLockfile();
  const path = join(workspace, "file");
  await writeFile(path, "x");
  const failure = await apply(planFrom(Vfs.empty(), Vfs.empty()), lockfile, path).catch(
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({ code: "IO_ERROR" });
  expect(await readFile(path, "utf8")).toBe("x");
  expect(await siblingsOf(workspace)).toEqual(["file"]);
});
