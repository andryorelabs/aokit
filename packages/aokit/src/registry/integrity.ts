import { createHash } from "node:crypto";

/**
 * Converts CRLF and lone CR line endings to LF, the canonical form integrity is computed over.
 */
export function normalizeLineEndings(text: string): string {
  return text.replaceAll(/\r\n?/g, "\n");
}

/**
 * Integrity of a text artifact: `sha256:<lowercase hex>` over its LF-normalized UTF-8 bytes.
 */
export function computeIntegrity(text: string): string {
  const digest = createHash("sha256").update(normalizeLineEndings(text), "utf8").digest("hex");
  return `sha256:${digest}`;
}
