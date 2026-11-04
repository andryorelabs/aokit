import { join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { selectMigrations } from "../../migrations/index.ts";
import { openProjectRegistry } from "../../project/registry.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";
import { LockfileError, readLockfile } from "../../lockfile/index.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { type LocalRegistry, RegistryError } from "../../registry/index.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { aokitMeta } from "../meta.ts";

const lockfileFileName = "aokit.lock.json";

const checkInput = z.object({
  directory: z
    .string()
    .default(".")
    .describe("Project directory that holds aokit.lock.json")
    .register(aokitMeta, { positional: 0, examples: ["./my-app"] }),
});

const moduleUpdateOutput = z.object({
  name: z.string(),
  current: z.string(),
  available: z.string(),
  migration: z.boolean(),
});

const checkOutput = z.object({
  release: z.object({ current: z.string(), available: z.string() }),
  modules: z.array(moduleUpdateOutput),
});

type ModuleUpdate = z.output<typeof moduleUpdateOutput>;

interface ReleaseState {
  readonly locked: string;
  readonly available: string;
}

async function loadLockfile(projectDir: string): Promise<Lockfile> {
  try {
    const parsed = await readLockfile(join(projectDir, lockfileFileName));
    if (parsed === null) {
      throw new AokitError(
        "LOCKFILE_MISSING",
        `No ${lockfileFileName} in ${projectDir}.`,
        "Run the command from an aokit Project, or pass its directory.",
      );
    }
    return parsed.lockfile;
  } catch (thrown) {
    if (thrown instanceof LockfileError) {
      throw new AokitError("INVALID_INPUT", thrown.message, thrown.fix);
    }
    throw thrown;
  }
}

async function readRegistry(
  name: string,
  lockfile: Lockfile,
  projectDir: string,
  cliVersion: string,
): Promise<LocalRegistry> {
  try {
    return await openProjectRegistry(lockfile, {
      projectDir,
      cliVersion,
      bundledRegistryPath,
      registry: name,
    });
  } catch (thrown) {
    if (thrown instanceof RegistryError) {
      if (thrown.code === "REGISTRY_CLI_TOO_OLD") {
        throw new AokitError("MIN_CLI_VERSION", thrown.message, thrown.fix);
      }
      throw new AokitError(
        "IO_ERROR",
        `Cannot read Registry "${name}" (${lockfile.registries[name]?.source ?? ""}): ${thrown.message}`,
        thrown.fix,
      );
    }
    throw thrown;
  }
}

async function readRegistries(
  lockfile: Lockfile,
  projectDir: string,
  cliVersion: string,
): Promise<Map<string, LocalRegistry>> {
  const entries = Object.entries(lockfile.registries).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const loaded = await Promise.all(
    entries.map(([name]) => readRegistry(name, lockfile, projectDir, cliVersion)),
  );
  const byName = new Map<string, LocalRegistry>();
  for (const [position, [name]] of entries.entries()) {
    const registry = loaded[position];
    if (registry !== undefined) {
      byName.set(name, registry);
    }
  }
  return byName;
}

function newest(versions: readonly string[]): string | undefined {
  return versions.toSorted((left, right) => Bun.semver.order(left, right)).at(-1);
}

function coversMigration(
  registry: LocalRegistry,
  name: string,
  current: string,
  available: string,
): boolean {
  const target = registry.version(name, available);
  return target !== undefined && selectMigrations(target.manifest, current, available).length > 0;
}

function moduleUpdates(
  lockfile: Lockfile,
  registries: ReadonlyMap<string, LocalRegistry>,
): ModuleUpdate[] {
  const updates: ModuleUpdate[] = [];
  for (const name of Object.keys(lockfile.modules).toSorted()) {
    const entry = lockfile.modules[name];
    const registry = registries.get(entry?.registry ?? "");
    const available = registry === undefined ? undefined : newest(registry.versions(name));
    if (
      entry !== undefined &&
      registry !== undefined &&
      available !== undefined &&
      Bun.semver.order(available, entry.version) > 0
    ) {
      updates.push({
        name,
        current: entry.version,
        available,
        migration: coversMigration(registry, name, entry.version, available),
      });
    }
  }
  return updates;
}

function releaseStates(
  lockfile: Lockfile,
  registries: ReadonlyMap<string, LocalRegistry>,
): ReleaseState[] {
  return Object.keys(lockfile.registries)
    .toSorted()
    .flatMap((name) => {
      const locked = lockfile.registries[name]?.release;
      const registry = registries.get(name);
      return locked === undefined || registry === undefined
        ? []
        : [{ locked, available: registry.release }];
    });
}

async function runCheck(
  directory: string,
  cliVersion: string,
): Promise<z.output<typeof checkOutput>> {
  const projectDir = resolvePath(directory);
  const lockfile = await loadLockfile(projectDir);
  const registries = await readRegistries(lockfile, projectDir, cliVersion);
  const modules = moduleUpdates(lockfile, registries);
  const releases = releaseStates(lockfile, registries);
  const newer = releases.find(({ locked, available }) => Bun.semver.order(available, locked) > 0);
  if (newer !== undefined || modules.length > 0) {
    throw new AokitError(
      "UPDATE_AVAILABLE",
      newer === undefined
        ? `${modules.length} Module update(s) available.`
        : `Release ${newer.available} is available (locked ${newer.locked}).`,
      "Run `aokit recopy` to render with the latest Release and Module versions.",
      { modules },
    );
  }
  const first = releases[0];
  return {
    release: { current: first?.locked ?? "", available: first?.available ?? "" },
    modules: [],
  };
}

export const checkCommand = defineCommand({
  name: "check",
  description: "Check a Project for Release and Module updates",
  input: checkInput,
  output: checkOutput,
  run(context, input) {
    return runCheck(input.directory, context.version);
  },
});
