import { stableStringify } from "@aokit/module";
import { lockfileSchema, type Lockfile } from "./schema.ts";

/**
 * Deterministic Lockfile text: validated, keys sorted at every level, LF, trailing newline.
 */
export function serializeLockfile(lockfile: Lockfile): string {
  return stableStringify(lockfileSchema.parse(lockfile));
}
