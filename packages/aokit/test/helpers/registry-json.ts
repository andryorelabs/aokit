import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { lockfileSchema, type Lockfile } from "../../src/lockfile/schema.ts";

const jsonRecordSchema = z.record(z.string(), z.unknown());

/** Parses JSON text without asserting its shape; narrow the result before using it. */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text);
}

/** Parses JSON text that must be an object. */
export function parseJsonRecord(text: string): Record<string, unknown> {
  return jsonRecordSchema.parse(parseJsonText(text));
}

/** Parses the text of an `aokit.lock.json` against the Lockfile schema. */
export function parseLockfileJson(text: string): Lockfile {
  return lockfileSchema.parse(parseJsonText(text));
}

/** Reads the `aokit.lock.json` of a Project. */
export async function readProjectLockfile(directory: string): Promise<Lockfile> {
  return parseLockfileJson(await readFile(join(directory, "aokit.lock.json"), "utf8"));
}

/** Rewrites the `aokit.lock.json` of a Project through `edit`. */
export async function editProjectLockfile(
  directory: string,
  edit: (lockfile: Lockfile) => void,
): Promise<void> {
  const path = join(directory, "aokit.lock.json");
  const lockfile = parseLockfileJson(await readFile(path, "utf8"));
  edit(lockfile);
  await writeFile(path, `${JSON.stringify(lockfile, null, 2)}\n`, "utf8");
}
