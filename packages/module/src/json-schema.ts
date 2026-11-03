import { z } from "zod";
import { stableStringify } from "./compile";
import { manifestSchema } from "./manifest";

/**
 * Generates the manifest JSON Schema from the Zod schema (input side).
 */
export function generateManifestJsonSchema(): unknown {
  return z.toJSONSchema(manifestSchema, { io: "input" });
}

/**
 * The text committed as `schema/module/v1.json`.
 */
export function manifestJsonSchemaText(): string {
  return stableStringify(generateManifestJsonSchema());
}
