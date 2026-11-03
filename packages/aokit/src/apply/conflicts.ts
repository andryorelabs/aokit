import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Git } from "../git/git.ts";
import { inSequence } from "./sequence.ts";

const newSiblingSuffix = ".aokit-new";

/** One Conflict to put on disk. */
export interface ConflictWrite {
  /** Project-relative path of the conflicted file. */
  readonly path: string;
  /** Merged text with conflict markers, written over the file; absent for binary content. */
  readonly merged?: string;
  /** Incoming content, written to `<path>.aokit-new` when there is no merged text. */
  readonly next: string | Uint8Array;
  /** Index stage 1; stages are only recorded for text Conflicts inside git. */
  readonly base: string;
  /** Index stage 2. */
  readonly user: string;
}

/** The one Project-relative file {@link writeConflicts} writes for `conflict`. */
export function conflictFile(conflict: ConflictWrite): string {
  return conflict.merged === undefined ? `${conflict.path}${newSiblingSuffix}` : conflict.path;
}

async function writeProjectFile(
  projectDirectory: string,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const destination = join(projectDirectory, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

/**
 * Writes merged content with markers over the conflicted files, writes `.aokit-new` siblings for
 * binary ones, and records index stages 1/2/3 through `git` for text Conflicts. It never stages.
 */
export async function writeConflicts(
  projectDirectory: string,
  conflicts: readonly ConflictWrite[],
  git?: Git,
): Promise<void> {
  await inSequence(conflicts, async (conflict) => {
    await writeProjectFile(
      projectDirectory,
      conflictFile(conflict),
      conflict.merged ?? conflict.next,
    );
    if (git !== undefined && conflict.merged !== undefined && typeof conflict.next === "string") {
      await git.writeConflictStages(conflict.path, {
        base: conflict.base,
        user: conflict.user,
        next: conflict.next,
      });
    }
  });
}
