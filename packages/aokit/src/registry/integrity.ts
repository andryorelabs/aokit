import { createHash } from "node:crypto";

/**
 * The shape of every integrity value: `sha256-` followed by 64 lowercase hex digits.
 */
export type Integrity = `sha256-${string}`;

/**
 * Converts CRLF and lone CR line endings to LF, the canonical form integrity is computed over.
 */
export function normalizeLineEndings(text: string): string {
  return text.replaceAll(/\r\n?/g, "\n");
}

/**
 * Integrity of a text artifact: `sha256-<lowercase hex>` over its LF-normalized UTF-8 bytes.
 */
export function computeIntegrity(text: string): Integrity {
  const digest = createHash("sha256").update(normalizeLineEndings(text), "utf8").digest("hex");
  return `sha256-${digest}`;
}

function byCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function updateFramed(hash: ReturnType<typeof createHash>, label: string, text: string): void {
  const content = normalizeLineEndings(text);
  hash.update(`${label}\0${Buffer.byteLength(content, "utf8")}\0`, "utf8");
  hash.update(content, "utf8");
}

/**
 * Integrity of a Module version, `sha256-<hex>`: one digest over the canonical manifest text and
 * every Module file as its path plus LF-normalized content, in codepoint order of the path. The
 * Registry index publishes it and the Lockfile records it verbatim.
 */
export function computeModuleIntegrity(
  manifestText: string,
  files: ReadonlyMap<string, string>,
): Integrity {
  const hash = createHash("sha256");
  updateFramed(hash, "manifest", manifestText);
  for (const path of [...files.keys()].toSorted(byCodepoint)) {
    updateFramed(hash, `file:${path}`, files.get(path) ?? "");
  }
  return `sha256-${hash.digest("hex")}`;
}
