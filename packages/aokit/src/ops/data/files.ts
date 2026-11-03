import type { OpVfs } from "../../engine/ops.ts";

const decoder = new TextDecoder();

/** Reads a VFS file as text; a missing file reads as the empty string. */
export function readText(vfs: OpVfs, path: string): string {
  const content = vfs.read(path);
  if (content === undefined) {
    return "";
  }
  return typeof content === "string" ? content : decoder.decode(content);
}

/** Writes `next` unless the file already exists with exactly that content. */
export function writeIfChanged(vfs: OpVfs, path: string, next: string): void {
  if (vfs.has(path) && readText(vfs, path) === next) {
    return;
  }
  vfs.write(path, next);
}
