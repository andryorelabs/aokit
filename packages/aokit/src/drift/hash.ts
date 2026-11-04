import { createHash } from "node:crypto";
import { isRegionFile, regionDigest, RegionSyntaxError } from "../patchers/markdown/regions.ts";

/** The Lockfile hash recorded for a file whose content is volatile. */
export const volatileHash = `sha256-${createHash("sha256").update("volatile").digest("hex")}`;

/** `sha256-<hex>` of file bytes; text is LF-normalized first, binary (NUL in the bytes) is not. */
export function hashFileBytes(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  const comparable = buffer.includes(0)
    ? buffer
    : Buffer.from(buffer.toString("utf8").replaceAll(/\r\n?/g, "\n"));
  return `sha256-${createHash("sha256").update(comparable).digest("hex")}`;
}

/**
 * The Lockfile hash of a tracked file. A Region file hashes only its aokit Regions, so text
 * outside markers is not drift; malformed markers fall back to the bytes and read as modified.
 */
export function hashTrackedFile(path: string, bytes: Uint8Array): string {
  if (!isRegionFile(path)) return hashFileBytes(bytes);
  try {
    return hashFileBytes(new TextEncoder().encode(regionDigest(new TextDecoder().decode(bytes))));
  } catch (error) {
    if (error instanceof RegionSyntaxError) return hashFileBytes(bytes);
    throw error;
  }
}
