import { readFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { z } from "zod";
import { apply, lockfileName } from "../../apply/index.ts";
import { Vfs, normalizeProjectPath } from "../../engine/vfs.ts";
import type { FileContent } from "../../engine/vfs.ts";
import type { Plan, PlanChange } from "../../engine/plan.ts";
import { assertCleanTree } from "../../git/index.ts";
import { LockfileError, readLockfile } from "../../lockfile/index.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import { renderFromLockfile } from "../../pipeline/index.ts";
import {
  RegionSyntaxError,
  isRegionFile,
  parseRegions,
  removeRegion,
  spliceRegions,
} from "../../patchers/markdown/regions.ts";
import { unifiedDiff } from "../../project/diff.ts";
import { toAokitError } from "../../project/errors.ts";
import { defineCommand } from "../command.ts";
import { AokitError } from "../envelope.ts";
import { lockfileMissingError } from "../errors.ts";
import { aokitMeta } from "../meta.ts";
import { bundledRegistryPath } from "../../registry/bundled.ts";

/** A Lockfile entry of the Project's file, with the Lockfile that holds it. */
export interface LockedFile {
  readonly directory: string;
  readonly path: string;
  readonly lockfile: Lockfile;
  readonly entry: Lockfile["files"][string];
}

function projectPath(rawPath: string): string {
  try {
    return normalizeProjectPath(rawPath);
  } catch {
    throw new AokitError(
      "INVALID_INPUT",
      `\`${rawPath}\` is not a Project-relative path`,
      "pass a path relative to the Project root, for example `src/main.tsx`",
    );
  }
}

async function readProjectLockfile(directory: string): Promise<Lockfile> {
  let parsed;
  try {
    parsed = await readLockfile(join(directory, lockfileName));
  } catch (thrown) {
    if (thrown instanceof LockfileError) {
      throw new AokitError("LOCKFILE_MISSING", thrown.message, thrown.fix);
    }
    throw thrown;
  }
  if (parsed === null) {
    throw lockfileMissingError("Run the command inside an aokit Project, or pass --directory.");
  }
  return parsed.lockfile;
}

/** Reads the Project's Lockfile and finds `path` in it; a missing path is `NOT_IN_LOCKFILE`. */
export async function findLockedFile(directoryFlag: string, rawPath: string): Promise<LockedFile> {
  const directory = resolvePath(directoryFlag);
  const lockfile = await readProjectLockfile(directory);
  const path = projectPath(rawPath);
  const entry = lockfile.files[path];
  if (entry === undefined) {
    throw new AokitError(
      "NOT_IN_LOCKFILE",
      `\`${path}\` is not in ${lockfileName}`,
      "run `aokit doctor` to list the files aokit tracks",
    );
  }
  return { directory, path, lockfile, entry };
}

const restoreInput = z.object({
  path: z
    .string()
    .describe("Project-relative path of the file to restore")
    .register(aokitMeta, { positional: 0, examples: ["src/main.tsx"] }),
  directory: z
    .string()
    .default(".")
    .describe("Project directory")
    .register(aokitMeta, { flag: "directory", examples: ["--directory ./my-app"] }),
  dryRun: z
    .boolean()
    .default(false)
    .describe("Print the change and write nothing")
    .register(aokitMeta, { flag: "dry-run", examples: ["--dry-run"] }),
  diff: z
    .boolean()
    .default(false)
    .describe("Print the unified diff; implies --dry-run")
    .register(aokitMeta, { flag: "diff", examples: ["--diff"] }),
  yes: z
    .boolean()
    .default(false)
    .describe("Non-interactive: write without asking")
    .register(aokitMeta, { flag: "yes", examples: ["--yes"] }),
  allowDirty: z
    .boolean()
    .default(false)
    .describe("Proceed despite uncommitted changes")
    .register(aokitMeta, { flag: "allow-dirty", examples: ["--allow-dirty"] }),
});

const restoreOutput = z.object({
  directory: z.string(),
  path: z.string(),
  mode: z.enum(["managed", "seed"]),
  previousMode: z.enum(["managed", "seed", "ejected"]),
  change: z.enum(["create", "update", "none"]),
  applied: z.boolean(),
  diff: z.string().optional(),
  warnings: z.array(z.string()),
});

async function readUserFile(directory: string, path: string): Promise<FileContent | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(directory, path));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return bytes.includes(0)
    ? new Uint8Array(bytes)
    : bytes.toString("utf8").replaceAll(/\r\n?/g, "\n");
}

function sameContent(left: FileContent, right: FileContent): boolean {
  if (typeof left === "string" && typeof right === "string") {
    return left === right;
  }
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

function withoutPath(lockfile: Lockfile, path: string): Lockfile {
  const files = Object.fromEntries(Object.entries(lockfile.files).filter(([key]) => key !== path));
  return { ...lockfile, files };
}

function restoredLockfile(locked: LockedFile, rendered: LockedFile["entry"]): Lockfile {
  const mode = rendered.mode === "seed" ? "seed" : "managed";
  return {
    ...locked.lockfile,
    files: {
      ...locked.lockfile.files,
      [locked.path]: { ...locked.entry, mode, hash: rendered.hash },
    },
  };
}

/**
 * Lays the rendered Regions over the user's file. When the Region ids or their order differ from
 * the Render, every aokit Region is removed first and re-inserted in Render order, so the result
 * hashes like a fresh Render while the text outside markers is kept.
 */
function restoreRegions(path: string, current: string, rendered: string): string {
  try {
    const renderedIds = parseRegions(rendered).map((span) => span.id);
    const currentIds = parseRegions(current).map((span) => span.id);
    const aligned =
      currentIds.length === renderedIds.length &&
      currentIds.every((id, index) => id === renderedIds[index]);
    if (aligned) {
      return spliceRegions(current, rendered);
    }
    const stripped = [...new Set([...currentIds, ...renderedIds])].reduce(
      (text, id) => removeRegion(text, id),
      current,
    );
    return spliceRegions(stripped, rendered);
  } catch (thrown) {
    if (thrown instanceof RegionSyntaxError) {
      throw new AokitError(
        "INVALID_INPUT",
        `\`${path}\` has malformed aokit markers: ${thrown.message}`,
        "fix or delete the broken marker lines by hand, then run `aokit restore` again",
      );
    }
    throw thrown;
  }
}

function restoreChanges(
  path: string,
  rendered: Plan,
  current: FileContent | undefined,
): PlanChange[] {
  const file = rendered.vfs.get(path);
  if (file === undefined) {
    return [];
  }
  const content =
    isRegionFile(path) && typeof current === "string" && typeof file.content === "string"
      ? restoreRegions(path, current, file.content)
      : file.content;
  if (current !== undefined && sameContent(current, content)) {
    return [];
  }
  const provenance = rendered.changes.find((change) => change.path === path)?.provenance ?? [];
  return [
    {
      type: current === undefined ? "create" : "update",
      path,
      content,
      ...(current === undefined ? {} : { previousContent: current }),
      ownership: file.ownership,
      mode: file.mode,
      provenance,
    },
  ];
}

export const restoreCommand = defineCommand({
  name: "restore",
  description: "Restore a file to its Render at the Lockfile versions",
  input: restoreInput,
  output: restoreOutput,
  async run(context, input) {
    const locked = await findLockedFile(input.directory, input.path);
    const clean = await assertCleanTree(locked.directory, {
      allowDirty: input.allowDirty,
      lockfile: withoutPath(locked.lockfile, locked.path),
    });
    try {
      const built = await renderFromLockfile(locked.lockfile, {
        projectDir: locked.directory,
        bundledRegistryPath,
        cliVersion: context.version,
      });
      const renderedEntry = built.lockfile.files[locked.path];
      if (renderedEntry === undefined || !built.plan.vfs.has(locked.path)) {
        throw new AokitError(
          "MODULE_VERSION_UNAVAILABLE",
          `\`${locked.path}\` is not produced by a Render at the locked Module versions`,
          "run `aokit recopy` to re-render the Project at the Release's versions",
        );
      }
      const current = await readUserFile(locked.directory, locked.path);
      const changes = restoreChanges(locked.path, built.plan, current);
      const plan: Plan = { changes, hash: built.plan.hash, vfs: Vfs.empty() };
      const result = {
        directory: locked.directory,
        path: locked.path,
        mode: renderedEntry.mode === "seed" ? "seed" : "managed",
        previousMode: locked.entry.mode,
        change: changes.length === 0 ? "none" : current === undefined ? "create" : "update",
        warnings: clean.warning === undefined ? [] : [clean.warning],
      } as const;
      if (input.dryRun || input.diff) {
        return {
          ...result,
          applied: false,
          ...(input.diff ? { diff: unifiedDiff(plan) } : {}),
        };
      }
      await apply(plan, restoredLockfile(locked, renderedEntry), locked.directory);
      return { ...result, applied: true, diff: unifiedDiff(plan) };
    } catch (thrown) {
      throw toAokitError(thrown);
    }
  },
});
