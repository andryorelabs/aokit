import type { FileContent } from "../engine/vfs.ts";

const binarySniffBytes = 8192;

/** True when both contents hold the same bytes. */
export function sameContent(left: FileContent, right: FileContent): boolean {
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
}

/** The text of `content`, decoded as UTF-8 when it is bytes. */
export function textOf(content: FileContent): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}

/**
 * Brings content read from the user's tree to the VFS convention: UTF-8 text with LF line
 * endings. Bytes with a NUL in the first 8 KB, or that are not valid UTF-8, stay bytes.
 */
export function normalizeUserContent(raw: FileContent | undefined): FileContent | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return raw.replace(/\r\n?/g, "\n");
  if (raw.subarray(0, binarySniffBytes).includes(0)) return raw;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw).replace(/\r\n?/g, "\n");
  } catch {
    return raw;
  }
}
