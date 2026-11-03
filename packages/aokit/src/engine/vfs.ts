import { readFile, readdir } from "node:fs/promises";
import { posix, relative as relativeFrom, resolve, sep } from "node:path";
import { EngineError } from "./errors.ts";

/** File content: text (always LF) or raw bytes. */
export type FileContent = string | Uint8Array;

/** Who owns a file after generation. */
export type Ownership = "managed" | "seed" | "ejected";

/** One file in the VFS. */
export interface VfsFile {
  readonly content: FileContent;
  readonly ownership: Ownership;
  readonly mode: string | undefined;
  readonly volatile: boolean;
}

/** Options for {@link Vfs.write}. */
export interface WriteOptions {
  readonly ownership?: Ownership;
  readonly mode?: string;
  readonly volatile?: boolean;
}

const ignoredDirectories = new Set([".git", "node_modules"]);

/** Converts CRLF and lone CR to LF. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Normalizes a Project-relative path and rejects absolute paths and escapes. */
export function normalizeProjectPath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (normalized === "" || normalized === "." || posix.isAbsolute(normalized)) {
    throw new EngineError("engine.invalid-path", `Invalid file path "${path}".`);
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new EngineError(
      "engine.invalid-path",
      `Path "${path}" escapes the Project root. Paths must stay inside the Project.`,
    );
  }
  return normalized;
}

/** Compares strings by Unicode codepoint. */
export function compareByCodepoint(left: string, right: string): number {
  const leftPoints = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

/** In-memory file tree; Modules run against it and never touch the disk. */
export class Vfs {
  private readonly entries = new Map<string, VfsFile>();

  /** An empty tree, as used by `create`. */
  static empty(): Vfs {
    return new Vfs();
  }

  /** Loads every file under `directory`, skipping `.git` and `node_modules`. */
  static async fromDirectory(directory: string): Promise<Vfs> {
    const vfs = new Vfs();
    const listing = await readdir(directory, { recursive: true, withFileTypes: true });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const files = listing
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const absolute = resolve(entry.parentPath, entry.name);
        const relative = relativeFrom(resolve(directory), absolute).split(sep).join("/");
        return { absolute, relative };
      })
      .filter(({ relative }) => !relative.split("/").some((s) => ignoredDirectories.has(s)));
    const loaded = await Promise.all(
      files.map(async ({ absolute, relative }) => ({
        relative,
        bytes: new Uint8Array(await readFile(absolute)),
      })),
    );
    for (const { relative, bytes } of loaded) {
      let content: FileContent;
      try {
        content = normalizeLineEndings(decoder.decode(bytes));
      } catch {
        content = bytes;
      }
      vfs.write(relative, content);
    }
    return vfs;
  }

  has(path: string): boolean {
    return this.entries.has(normalizeProjectPath(path));
  }

  get(path: string): VfsFile | undefined {
    return this.entries.get(normalizeProjectPath(path));
  }

  read(path: string): FileContent | undefined {
    return this.get(path)?.content;
  }

  /** Writes a file; text is LF-normalized. Unspecified options keep the existing file's values. */
  write(path: string, content: FileContent, options: WriteOptions = {}): void {
    const key = normalizeProjectPath(path);
    const existing = this.entries.get(key);
    this.entries.set(key, {
      content: typeof content === "string" ? normalizeLineEndings(content) : content,
      ownership: options.ownership ?? existing?.ownership ?? "managed",
      mode: options.mode ?? existing?.mode,
      volatile: options.volatile ?? existing?.volatile ?? false,
    });
  }

  delete(path: string): boolean {
    return this.entries.delete(normalizeProjectPath(path));
  }

  /** All paths, sorted by Unicode codepoint. */
  paths(): string[] {
    return [...this.entries.keys()].toSorted(compareByCodepoint);
  }

  clone(): Vfs {
    const copy = new Vfs();
    for (const [path, file] of this.entries) {
      copy.entries.set(path, file);
    }
    return copy;
  }
}
