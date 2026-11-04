import { resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import { apply } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import type { LayoutName } from "../engine/layout.ts";
import type { Plan, PlanChange } from "../engine/plan.ts";
import type { Lockfile } from "../lockfile/schema.ts";
import { formatterForSelection } from "../format/index.ts";
import { buildProject } from "../pipeline/index.ts";
import { resolve } from "../resolver/resolve.ts";
import { completeAnswers, parseAnswers } from "../project/answers.ts";
import { unifiedDiff } from "../project/diff.ts";
import { fromResolveError, toAokitError } from "../project/errors.ts";
import { runInstall } from "../project/install.ts";
import type { RegistryInfo } from "../pipeline/assemble.ts";
import {
  type CreateRegistries,
  loadCreateRegistries,
  type RegistryAdapters,
} from "../project/registry.ts";
import type { Registry } from "../registry/index.ts";
import { reproduceCommand } from "../project/reproduce.ts";
import { renderFromSource } from "./from.ts";
import { checkTarget } from "./target.ts";

/** Everything `create` needs besides the process. */
export interface CreateRequest {
  readonly directory: string;
  readonly layout: LayoutName;
  readonly modules: string[];
  readonly answers: readonly string[];
  readonly registry: string | undefined;
  readonly dryRun: boolean;
  readonly diff: boolean;
  readonly install: boolean;
  /** Local Lockfile to create from; Modules, Layout and Registries come from it. */
  readonly from?: string | undefined;
  readonly version: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Every `--trust <name|source>` value; none by default. */
  readonly trust?: readonly string[];
  /** Whether an untrusted Registry may be asked about; `false` by default. */
  readonly interactive?: boolean;
  /** How Registries are reached; the real network, cache and prompt by default. */
  readonly adapters?: RegistryAdapters;
}

/** One change of the Plan with the Modules behind it. */
export interface CreatePlanChange {
  readonly type: PlanChange["type"];
  readonly path: string;
  readonly mode: string | null;
  readonly ownership: PlanChange["ownership"];
  readonly provenance: { readonly module: string; readonly source: string }[];
}

/** Result of a create run. */
export interface CreateResult {
  readonly directory: string;
  readonly layout: LayoutName;
  readonly modules: string[];
  readonly applied: boolean;
  readonly installed: boolean;
  readonly plan: { readonly hash: string; readonly changes: CreatePlanChange[] };
  readonly diff?: string;
  readonly warnings: string[];
  readonly reproduce: string;
}

function describeEntry(entry: PlanChange["provenance"][number]["entry"]): string {
  if (entry.kind === "file") {
    return `file ${entry.from}`;
  }
  return entry.kind === "op" ? `op ${entry.op}` : entry.kind;
}

export function toPlanChange(change: PlanChange): CreatePlanChange {
  return {
    type: change.type,
    path: change.path,
    mode: change.mode ?? null,
    ownership: change.ownership,
    provenance: change.provenance.map((entry) => ({
      module: entry.module,
      source: describeEntry(entry.entry),
    })),
  };
}

function warningTexts(warnings: readonly { readonly message: string }[]): string[] {
  return warnings.map((warning) => warning.message);
}

/**
 * The Registry a new Project records as its own: the native one when a resolved Module comes from
 * it, else the shadcn Registry of the first resolved Adapted Module, as a Project of only Adapted
 * Modules has always recorded it.
 */
function primaryRegistry(
  opened: CreateRegistries,
  manifests: readonly ModuleManifest[],
): { readonly info: RegistryInfo; readonly catalog: Registry["currentCatalog"] } {
  const origin = new Map(
    opened.available.map((module) => [module.manifest.name, module.registry ?? opened.native.key]),
  );
  const keys = manifests.map((manifest) => origin.get(manifest.name) ?? opened.native.key);
  const key = keys.includes(opened.native.key) ? opened.native.key : (keys[0] ?? opened.native.key);
  const registry = opened.registries.get(key) ?? opened.native.registry;
  const entry = opened.entries[key];
  return {
    info: {
      name: key,
      source: key === opened.native.key ? opened.native.source : (entry?.source ?? ""),
      release: registry.release,
      minCliVersion: registry.index.minCliVersion,
      ...(entry?.trusted === true ? { trusted: true } : {}),
    },
    catalog: registry.currentCatalog,
  };
}

async function plan(request: CreateRequest): Promise<PlannedProject> {
  if (request.modules.length === 0) {
    throw new AokitError(
      "MISSING_VALUE",
      "missing value for `--modules`",
      "pass `--modules a,b,c`, for example `--modules oxc,vite-react`",
    );
  }
  const opened = await loadCreateRegistries(request.registry, request.modules, request.version, {
    projectDir: request.directory,
    trustFlags: request.trust ?? [],
    interactive: request.interactive ?? false,
    adapters: { env: request.env, ...request.adapters },
  });
  const selection = [...opened.names];
  const { available } = opened;
  const pulledIn = [...opened.pulledIn];
  const resolved = resolve(
    { modules: selection, locked: pulledIn },
    available.map((module) => module.manifest),
  );
  if (!resolved.ok) {
    throw fromResolveError(resolved.error);
  }
  const manifests: ModuleManifest[] = resolved.modules.map((module) => module.manifest);
  const primary = primaryRegistry(opened, manifests);
  const answers = completeAnswers(parseAnswers(request.answers, manifests), manifests);
  const formatter = formatterForSelection({ catalog: primary.catalog, modules: manifests });
  const built = await buildProject({
    selection,
    locked: pulledIn,
    available,
    answers,
    layout: request.layout,
    catalog: primary.catalog,
    context: { now: new Date(), random: Math.random, env: request.env },
    registry: primary.info,
    registries: opened.entries,
    ...(formatter === undefined ? {} : { formatter }),
  });
  if (!built.ok) {
    throw fromResolveError(built.error);
  }
  return {
    plan: built.plan,
    lockfile: built.lockfile,
    warnings: warningTexts(built.warnings),
    layout: request.layout,
    moduleNames: manifests.map((manifest) => manifest.name),
    reproduce: reproduceCommand({
      directory: request.directory,
      layout: request.layout,
      modules: request.modules,
      answers,
      registry: request.registry,
      install: request.install,
    }),
  };
}

/** A Project ready to apply, however it was selected. */
interface PlannedProject {
  readonly plan: Plan;
  readonly lockfile: Lockfile;
  readonly warnings: string[];
  readonly layout: LayoutName;
  readonly moduleNames: string[];
  readonly reproduce: string;
}

function reproduceFrom(request: CreateRequest): string {
  const answerFlags = request.answers.map((answer) => `--answer ${shellWord(answer)}`);
  return [
    "aokit create",
    shellWord(request.directory),
    `--from ${shellWord(request.from ?? "")}`,
    ...answerFlags,
    ...(request.install ? [] : ["--no-install"]),
    "--yes",
  ].join(" ");
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

async function planFrom(request: CreateRequest, directory: string): Promise<PlannedProject> {
  const rendered = await renderFromSource({
    from: request.from ?? "",
    directory,
    answers: request.answers,
    cliVersion: request.version,
    trust: request.trust ?? [],
    interactive: request.interactive ?? false,
    adapters: { env: request.env, ...request.adapters },
  });
  return {
    plan: rendered.built.plan,
    lockfile: rendered.lockfile,
    warnings: warningTexts(rendered.built.warnings),
    layout: rendered.lockfile.layout,
    moduleNames: Object.keys(rendered.lockfile.modules).toSorted(),
    reproduce: reproduceFrom(request),
  };
}

/**
 * Builds a new Project from a selection of Modules in the local Registry: target check, Resolver,
 * Engine, format phase, Plan, then atomic apply with the Lockfile last, then `bun install`.
 * `dryRun` and `diff` stop after the Plan.
 */
export async function runCreate(request: CreateRequest): Promise<CreateResult> {
  const directory = resolvePath(request.directory);
  await checkTarget(directory);
  try {
    const planned =
      request.from === undefined ? await plan(request) : await planFrom(request, directory);
    const changes = planned.plan.changes.map(toPlanChange);
    const base = {
      directory,
      layout: planned.layout,
      modules: planned.moduleNames,
      plan: { hash: planned.plan.hash, changes },
      warnings: planned.warnings,
      reproduce: planned.reproduce,
    };
    if (request.dryRun || request.diff) {
      return {
        ...base,
        applied: false,
        installed: false,
        ...(request.diff ? { diff: unifiedDiff(planned.plan) } : {}),
      };
    }
    await apply(planned.plan, planned.lockfile, directory);
    if (request.install) {
      await runInstall(directory, request.env);
    }
    return { ...base, applied: true, installed: request.install };
  } catch (thrown) {
    throw toAokitError(thrown);
  }
}
