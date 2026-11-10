import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { runCommand, type CommandContext } from "../../src/cli/command.ts";
import { createCommand } from "../../src/cli/commands/create.ts";
import { doctorCommand } from "../../src/cli/commands/doctor.ts";
import { exposedCommands } from "../../src/cli/commands/registry.ts";
import { exitCodeForEnvelope } from "../../src/cli/envelope.ts";
import { cliVersion } from "../../src/cli/version.ts";
import { stashRoot as stashRootOf } from "../../src/apply/stash.ts";
import { openGit } from "../../src/git/index.ts";
import { abortUpdate, writeUpdateMarker } from "../../src/update/state.ts";
import { runGitChecked } from "../../src/git/run.ts";
import { z } from "zod";
import {
  type JsonObject,
  isJsonObject,
  objectAt,
  parseJsonObject,
  valueAt,
} from "../helpers/update-json.ts";

const context: CommandContext = { version: cliVersion, env: {}, commands: exposedCommands };
const workspaces: string[] = [];

afterAll(() => {
  for (const path of workspaces) rmSync(path, { recursive: true, force: true });
});

async function createProject(useGit: boolean, modules = "oxc"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "aokit-doctor-"));
  workspaces.push(root);
  const directory = join(root, "app");
  const created = await runCommand(createCommand, context, {
    directory,
    modules,
    yes: true,
    install: false,
    git: false,
  });
  expect(created.ok).toBe(true);
  if (useGit) {
    await runGitChecked(directory, ["init", "-q"]);
    await runGitChecked(directory, ["add", "README.md"]);
  }
  return directory;
}

async function doctor(directory: string) {
  const envelope = await runCommand(doctorCommand, context, { directory });
  return { envelope, exitCode: exitCodeForEnvelope(envelope) };
}

const lockfileFilesSchema = z.object({
  files: z.record(z.string(), z.object({ hash: z.string(), mode: z.string() })),
});

function lockfileOf(directory: string) {
  return lockfileFilesSchema.parse(readLockfileJson(directory));
}

function readLockfileJson(directory: string): JsonObject {
  return parseJsonObject(readFileSync(join(directory, "aokit.lock.json"), "utf8"));
}

function stateMap(data: unknown): Record<string, string> {
  const files = doctorCommand.output.parse(data).files;
  return Object.fromEntries(files.map((file) => [file.path, file.state]));
}

for (const useGit of [true, false]) {
  describe(`doctor ${useGit ? "in git" : "outside git"}`, () => {
    let directory = "";
    beforeAll(async () => {
      directory = await createProject(useGit);
    });

    test("an untouched Project is clean with every file pristine", async () => {
      const { envelope, exitCode } = await doctor(directory);
      expect(exitCode).toBe(0);
      expect(envelope.ok).toBe(true);
      const states = new Set(Object.values(stateMap(envelope.data)));
      expect([...states].filter((state) => state !== "pristine" && state !== "volatile")).toEqual(
        [],
      );
    });

    test("an edited, a deleted and a new file report modified, deleted and unknown", async () => {
      const lockfile = lockfileOf(directory);
      const managed = Object.entries(lockfile.files)
        .filter(([path, entry]) => entry.mode === "managed" && !path.endsWith("package.json"))
        .map(([path]) => path);
      const edited = managed[0] ?? "";
      const removed = managed[1] ?? "";
      expect(edited).not.toBe("");
      expect(removed).not.toBe("");
      const original = readFileSync(join(directory, edited), "utf8");
      writeFileSync(join(directory, edited), `${original}\n// edit\n`);
      const removedContent = readFileSync(join(directory, removed), "utf8");
      rmSync(join(directory, removed));
      mkdirSync(join(directory, "src"), { recursive: true });
      writeFileSync(join(directory, "src", "brand-new.ts"), "export {};\n");

      const { envelope, exitCode } = await doctor(directory);
      expect(exitCode).toBe(1);
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.code).toBe("DRIFT");
      const states = stateMap(envelope.data);
      expect(states[edited]).toBe("modified");
      expect(states[removed]).toBe("deleted");
      expect(states["src/brand-new.ts"]).toBe("unknown");
      const others = Object.entries(states).filter(
        ([path]) => ![edited, removed, "src/brand-new.ts"].includes(path),
      );
      expect(others.every(([, state]) => state === "pristine" || state === "volatile")).toBe(true);
      expect(Object.values(states).filter((state) => state === "modified")).toHaveLength(1);
      expect(doctorOutputParses(envelope.data)).toBe(true);

      writeFileSync(join(directory, edited), original);
      writeFileSync(join(directory, removed), removedContent);
      rmSync(join(directory, "src", "brand-new.ts"));
    });

    test("CRLF content hashes like LF", async () => {
      const lockfile = lockfileOf(directory);
      const path = Object.entries(lockfile.files).find(
        ([file, entry]) => entry.mode === "managed" && file.endsWith(".json"),
      )?.[0];
      expect(path).toBeDefined();
      const original = readFileSync(join(directory, path ?? ""), "utf8");
      writeFileSync(join(directory, path ?? ""), original.replaceAll("\n", "\r\n"));
      const { envelope } = await doctor(directory);
      expect(stateMap(envelope.data)[path ?? ""]).toBe("pristine");
      writeFileSync(join(directory, path ?? ""), original);
    });

    test("a .aokit-new file is unknown", async () => {
      const lockfile = lockfileOf(directory);
      const path = Object.keys(lockfile.files).find((file) => !file.endsWith("package.json")) ?? "";
      writeFileSync(join(directory, `${path}.aokit-new`), "x");
      const { envelope, exitCode } = await doctor(directory);
      expect(exitCode).toBe(1);
      expect(stateMap(envelope.data)[`${path}.aokit-new`]).toBe("unknown");
      rmSync(join(directory, `${path}.aokit-new`));
    });

    test("an ejected file reports no drift when edited", async () => {
      const lockfile = lockfileOf(directory);
      const path = Object.keys(lockfile.files).find((file) => !file.endsWith("package.json")) ?? "";
      const edited = readLockfileJson(directory);
      objectAt(edited, "files", path)["mode"] = "ejected";
      writeFileSync(join(directory, "aokit.lock.json"), JSON.stringify(edited));
      const original = readFileSync(join(directory, path), "utf8");
      writeFileSync(join(directory, path), `${original}\nchanged\n`);
      const { envelope, exitCode } = await doctor(directory);
      expect(exitCode).toBe(0);
      expect(stateMap(envelope.data)[path]).toBe("pristine");
      writeFileSync(join(directory, path), original);
      objectAt(edited, "files", path)["mode"] = lockfile.files[path]?.mode ?? null;
      writeFileSync(join(directory, "aokit.lock.json"), JSON.stringify(edited));
    });

    test("a volatile-hash file classifies volatile, not modified", async () => {
      const lockfile = readLockfileJson(directory);
      const path =
        Object.keys(objectAt(lockfile, "files")).find((file) => !file.endsWith("package.json")) ??
        "";
      const previous = objectAt(lockfile, "files", path)["hash"] ?? null;
      const { createHash } = await import("node:crypto");
      objectAt(lockfile, "files", path)["hash"] =
        `sha256-${createHash("sha256").update("volatile").digest("hex")}`;
      writeFileSync(join(directory, "aokit.lock.json"), JSON.stringify(lockfile));
      const { envelope, exitCode } = await doctor(directory);
      expect(exitCode).toBe(0);
      expect(stateMap(envelope.data)[path]).toBe("volatile");
      objectAt(lockfile, "files", path)["hash"] = previous;
      writeFileSync(join(directory, "aokit.lock.json"), JSON.stringify(lockfile));
    });

    test("a leftover stash is reported and removed", async () => {
      const stashRoot = join(
        await stashRootOf(directory, (await openGit(directory)) ?? undefined),
        "old",
      );
      mkdirSync(stashRoot, { recursive: true });
      writeFileSync(join(stashRoot, "leftover.txt"), "x");
      const first = await doctor(directory);
      expect(first.exitCode).toBe(1);
      expect(doctorCommand.output.parse(first.envelope.data).problems.map((p) => p.kind)).toContain(
        "stash",
      );
      expect((await doctor(directory)).exitCode).toBe(0);
    });

    test("a marked update stash is reported with the abort fix and never removed", async () => {
      const git = (await openGit(directory)) ?? undefined;
      const root = await stashRootOf(directory, git);
      const marked = join(root, "marked");
      const unmarked = join(root, "unmarked");
      mkdirSync(marked, { recursive: true });
      mkdirSync(unmarked, { recursive: true });
      writeFileSync(
        join(marked, "aokit.lock.json"),
        readFileSync(join(directory, "aokit.lock.json"), "utf8"),
      );
      writeFileSync(join(unmarked, "leftover.txt"), "x");
      await writeUpdateMarker(directory, git, {
        stashDirectory: marked,
        conflictedPaths: ["a.txt"],
        newSiblingPaths: [],
        previousLockfile: readFileSync(join(directory, "aokit.lock.json"), "utf8"),
      });
      const first = await doctor(directory);
      const report = doctorCommand.output.parse(first.envelope.data);
      expect(first.exitCode).toBe(1);
      expect(report.problems.find((problem) => problem.kind === "update")?.fix).toBe(
        "aokit update --abort",
      );
      expect(report.removedStashes).toEqual([relative(directory, unmarked)]);
      expect(existsSync(marked)).toBe(true);
      expect(existsSync(unmarked)).toBe(false);
      const second = await doctor(directory);
      expect(second.exitCode).toBe(1);
      expect(existsSync(marked)).toBe(true);
      await abortUpdate(directory, git);
      expect(existsSync(marked)).toBe(false);
      expect((await doctor(directory)).exitCode).toBe(0);
    });

    test("a missing dependency in package.json is a problem", async () => {
      const manifestPath = join(directory, "package.json");
      const original = readFileSync(manifestPath, "utf8");
      const manifest = parseJsonObject(original);
      const lockfile = readLockfileJson(directory);
      const name = Object.keys(objectAt(lockfile, "deps"))[0] ?? "";
      expect(name).not.toBe("");
      for (const section of ["devDependencies", "dependencies"]) {
        const dependencies = valueAt(manifest, section);
        if (isJsonObject(dependencies)) delete dependencies[name];
      }
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const { envelope } = await doctor(directory);
      const { problems } = doctorCommand.output.parse(envelope.data);
      expect(problems.some((problem) => problem.kind === "deps")).toBe(true);
      writeFileSync(manifestPath, original);
    });
  });
}

describe("doctor Lockfile errors", () => {
  test("a missing Lockfile exits 5 with LOCKFILE_MISSING", async () => {
    const root = mkdtempSync(join(tmpdir(), "aokit-doctor-empty-"));
    workspaces.push(root);
    const { envelope, exitCode } = await doctor(root);
    expect(exitCode).toBe(5);
    expect(envelope.error?.code).toBe("LOCKFILE_MISSING");
  });

  test("an unreadable Lockfile exits 5", async () => {
    const root = mkdtempSync(join(tmpdir(), "aokit-doctor-bad-"));
    workspaces.push(root);
    writeFileSync(join(root, "aokit.lock.json"), "{not json");
    const { envelope, exitCode } = await doctor(root);
    expect(exitCode).toBe(5);
    expect(envelope.error?.code).toBe("LOCKFILE_MISSING");
  });
});

function doctorOutputParses(data: unknown): boolean {
  return doctorCommand.output.safeParse(data).success;
}

function rewriteLockfile(directory: string, change: (lockfile: JsonObject) => void): void {
  const path = join(directory, "aokit.lock.json");
  const lockfile = parseJsonObject(readFileSync(path, "utf8"));
  change(lockfile);
  writeFileSync(path, JSON.stringify(lockfile));
}

async function problemKinds(directory: string): Promise<string[]> {
  const { envelope } = await doctor(directory);
  return doctorCommand.output.parse(envelope.data).problems.map((problem) => problem.kind);
}

describe("doctor Project checks", () => {
  test("a Module integrity that differs from the Registry is reported", async () => {
    const directory = await createProject(false);
    rewriteLockfile(directory, (lockfile) => {
      const name = Object.keys(objectAt(lockfile, "modules"))[0] ?? "";
      objectAt(lockfile, "modules", name)["integrity"] = `sha256-${"0".repeat(64)}`;
    });
    expect(await problemKinds(directory)).toContain("integrity");
  });

  test("a Registry that needs a newer CLI is reported", async () => {
    const directory = await createProject(false);
    rewriteLockfile(directory, (lockfile) => {
      const name = Object.keys(objectAt(lockfile, "registries"))[0] ?? "";
      objectAt(lockfile, "registries", name)["minCliVersion"] = "999.0.0";
    });
    expect(await problemKinds(directory)).toContain("cli");
  });

  test("a locked Module whose requirement is missing fails the Resolver check", async () => {
    const directory = await createProject(false, "vite-react,tailwind4");
    rewriteLockfile(directory, (lockfile) => {
      delete objectAt(lockfile, "modules")["vite-react"];
    });
    expect(await problemKinds(directory)).toContain("resolver");
  });
});

describe("doctor paths and worktrees", () => {
  test.each([true, false])(
    "a new file with spaces and unicode in its path is reported unknown (git: %p)",
    async (useGit) => {
      const directory = await createProject(useGit);
      const path = "src/my file é.ts";
      mkdirSync(join(directory, "src"), { recursive: true });
      writeFileSync(join(directory, path), "export {};\n");
      const { envelope } = await doctor(directory);
      expect(stateMap(envelope.data)[path]).toBe("unknown");
    },
  );

  test("a Project in a linked git worktree is clean", async () => {
    const directory = await createProject(true);
    await runGitChecked(directory, ["add", "-A"]);
    await runGitChecked(directory, [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "-m",
      "init",
    ]);
    const linked = join(directory, "..", "linked");
    await runGitChecked(directory, ["worktree", "add", "-q", linked, "-b", "linked"]);
    const { exitCode } = await doctor(linked);
    expect(exitCode).toBe(0);
  });
});
