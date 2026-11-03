import { createHash } from "node:crypto";

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
