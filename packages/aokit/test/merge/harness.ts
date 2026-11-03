import { createHash } from "node:crypto";
import { Vfs, type FileContent } from "../../src/engine/vfs.ts";
import type { Plan } from "../../src/engine/plan.ts";
import { hashVfs } from "../../src/engine/plan.ts";
import type { Lockfile } from "../../src/lockfile/schema.ts";
import type { DriftOf } from "../../src/merge/index.ts";
import type { BuiltProject } from "../../src/pipeline/build.ts";

/** A fixture file: bare content or content with options. */
type FixtureFile =
  | FileContent
  | {
      readonly content: FileContent;
      readonly ownership?: "managed" | "seed";
      readonly volatile?: boolean;
      readonly owners?: readonly string[];
    };

export type FixtureFiles = Record<string, FixtureFile>;

function normalized(file: FixtureFile): {
  content: FileContent;
  ownership: "managed" | "seed";
  volatile: boolean;
  owners: readonly string[];
} {
  const options = typeof file === "string" || file instanceof Uint8Array ? { content: file } : file;
  return {
    content: options.content,
    ownership: "ownership" in options ? (options.ownership ?? "managed") : "managed",
    volatile: "volatile" in options ? (options.volatile ?? false) : false,
    owners: "owners" in options ? (options.owners ?? ["mod"]) : ["mod"],
  };
}

/** The `sha256-<hex>` of LF-normalized content, as the Lockfile records it. */
export function hashOf(content: FileContent): string {
  const bytes =
    typeof content === "string"
      ? new TextEncoder().encode(content.replace(/\r\n?/g, "\n"))
      : content;
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

export function vfsOf(files: FixtureFiles): Vfs {
  const vfs = Vfs.empty();
  for (const [path, file] of Object.entries(files)) {
    const { content, ownership, volatile } = normalized(file);
    vfs.write(path, content, { ownership, volatile });
  }
  return vfs;
}

export function lockfileOf(files: FixtureFiles, mode?: Record<string, "ejected">): Lockfile {
  const entries: Lockfile["files"] = {};
  for (const [path, file] of Object.entries(files)) {
    const { content, ownership, volatile, owners } = normalized(file);
    entries[path] = {
      owners: [...owners],
      mode: mode?.[path] ?? ownership,
      hash: volatile ? hashOf("volatile") : hashOf(content),
    };
  }
  return {
    $schema: "https://aokit.dev/schema/lockfile/v2.json",
    lockfileVersion: 2,
    cliVersion: "0.0.0",
    protocolVersion: 1,
    layout: "single",
    registries: { local: { source: "bundled", release: "2026.11.0", minCliVersion: "0.0.0" } },
    modules: {
      mod: {
        version: "1.0.0",
        registry: "local",
        selected: true,
        integrity: `sha256-${"0".repeat(64)}`,
        answers: {},
      },
    },
    files: entries,
    deps: {},
  };
}

export function builtOf(files: FixtureFiles): BuiltProject {
  const vfs = vfsOf(files);
  const plan: Plan = {
    changes: Object.keys(files).map((path) => ({
      type: "create" as const,
      path,
      content: vfs.read(path) ?? "",
      ownership: vfs.get(path)?.ownership ?? "managed",
      mode: undefined,
      provenance: [{ module: "mod", entry: { kind: "file" as const, from: path } }],
    })),
    hash: hashVfs(vfs),
    vfs,
  };
  const lockfile = lockfileOf(files);
  return { ok: true, plan, lockfile, lockfileText: "", warnings: [] };
}

/** Classifies by comparing the user's content hash with the Lockfile entry. */
export const driftOf: DriftOf = ({ entry, user }) => {
  if (entry === undefined) return user === undefined ? "deleted" : "unknown";
  if (user === undefined) return "deleted";
  if (entry.hash === hashOf("volatile")) return "volatile";
  return hashOf(user) === entry.hash ? "pristine" : "modified";
};
