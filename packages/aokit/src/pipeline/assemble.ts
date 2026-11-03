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
const volatileMarker = "volatile";

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
  /** Files recorded by the Lockfile on disk, whose owners carry over for unchanged files. */
  readonly previousFiles?: Lockfile["files"];
}

function sha256(content: FileContent): string {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}

function fileEntries(plan: Plan, previous: Lockfile["files"]): Lockfile["files"] {
  const provenance = new Map(plan.changes.map((change) => [change.path, change.provenance]));
  const files: Lockfile["files"] = {};
  for (const path of plan.vfs.paths()) {
    const file = plan.vfs.get(path);
    if (file === undefined) {
      continue;
    }
    const fromPlan = [
      ...new Set(
        (provenance.get(path) ?? [])
          .filter((entry) => entry.overridden !== true && entry.entry.kind !== "formatter")
          .map((entry) => entry.module),
      ),
    ];
    const owners = (fromPlan.length > 0 ? fromPlan : (previous[path]?.owners ?? [])).toSorted();
    if (owners.length > 0) {
      files[path] = {
        owners,
        mode: file.ownership,
        hash: file.volatile ? sha256(volatileMarker) : sha256(file.content),
      };
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
    files: fileEntries(options.plan, options.previousFiles ?? {}),
    deps: options.deps,
  };
}
