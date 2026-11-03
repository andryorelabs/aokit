import { stableStringify } from "@aokit/module";
import { z } from "zod";
import { lockfileSchema } from "./schema.ts";

/**
 * Generates the Lockfile JSON Schema from the Zod schema (input side).
 */
function generateLockfileJsonSchema(): unknown {
  return z.toJSONSchema(lockfileSchema, { io: "input" });
}

/**
 * The text committed as `schema/lockfile/v1.json`.
 */
export function lockfileJsonSchemaText(): string {
  return stableStringify(generateLockfileJsonSchema());
}
