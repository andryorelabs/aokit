import { createHash } from "node:crypto";
import { type ModuleManifest, stableStringify } from "@aokit/module";
import { cliVersion } from "../cli/version.ts";
import type { AnswerValue } from "../engine/interpolate.ts";
import type { LayoutName } from "../engine/layout.ts";
import type { Plan } from "../engine/plan.ts";
import type { FileContent } from "../engine/vfs.ts";
import { type Lockfile, currentLockfileVersion } from "../lockfile/schema.ts";

const lockfileSchemaUrl = "https://aokit.dev/schema/lockfile/v1.json";
const protocolVersion = 1;

/** Where the selected Modules came from; recorded in the Lockfile `registries` map. */
export interface RegistryInfo {
  readonly name: string;
  readonly source: string;
  readonly release: string;
  readonly minCliVersion: string;
}

/** A resolved Module with the answers it ran with. */
export interface AssembledModule {
  readonly manifest: ModuleManifest;
  readonly answers: Readonly<Record<string, AnswerValue>>;
}

/** Inputs of {@link assembleLockfile}. */
interface AssembleOptions {
  readonly plan: Plan;
  readonly modules: readonly AssembledModule[];
  readonly layout: LayoutName;
  readonly registry: RegistryInfo;
  readonly deps: Lockfile["deps"];
}

function sha256(content: FileContent): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileEntries(plan: Plan): Lockfile["files"] {
  const files: Lockfile["files"] = {};
  for (const change of plan.changes) {
    if (change.type === "delete" || change.content === undefined) {
      continue;
    }
    const owners = [
      ...new Set(
        change.provenance
          .filter((entry) => entry.overridden !== true && entry.entry.kind !== "formatter")
          .map((entry) => entry.module),
      ),
    ].toSorted();
    if (owners.length > 0) {
      files[change.path] = { owners, mode: change.ownership, hash: sha256(change.content) };
    }
  }
  return files;
}

/** Builds the Lockfile for a Plan: Modules, files with owners/mode/hash, and recorded deps. */
export function assembleLockfile(options: AssembleOptions): Lockfile {
  const modules: Lockfile["modules"] = {};
  for (const { manifest, answers } of options.modules) {
    modules[manifest.name] = {
      version: manifest.version,
      registry: options.registry.name,
      integrity: sha256(stableStringify(manifest)),
      answers: { ...answers },
    };
  }
  return {
    $schema: lockfileSchemaUrl,
    lockfileVersion: currentLockfileVersion,
    cliVersion,
    protocolVersion,
    layout: options.layout,
    registries: {
      [options.registry.name]: {
        source: options.registry.source,
        release: options.registry.release,
        minCliVersion: options.registry.minCliVersion,
      },
    },
    modules,
    files: fileEntries(options.plan),
    deps: options.deps,
  };
}
