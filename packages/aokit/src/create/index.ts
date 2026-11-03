import { relative, resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import { apply } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import type { LayoutName } from "../engine/layout.ts";
import type { PlanChange } from "../engine/plan.ts";
import { formatterForSelection } from "../format/index.ts";
import { buildProject } from "../pipeline/index.ts";
import { resolve } from "../resolver/resolve.ts";
import { completeAnswers, parseAnswers } from "../project/answers.ts";
import { unifiedDiff } from "../project/diff.ts";
import { fromResolveError, toAokitError } from "../project/errors.ts";
import { runInstall } from "../project/install.ts";
import { loadRegistry } from "../project/registry.ts";
import { reproduceCommand } from "../project/reproduce.ts";
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
  readonly version: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** One change of the Plan with the Modules behind it. */
interface CreatePlanChange {
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

function toPlanChange(change: PlanChange): CreatePlanChange {
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

async function plan(request: CreateRequest) {
  if (request.modules.length === 0) {
    throw new AokitError(
      "MISSING_VALUE",
      "missing value for `--modules`",
      "pass `--modules a,b,c`, for example `--modules oxc,vite-react`",
    );
  }
  const loaded = await loadRegistry(request.registry, request.version);
  const { registry, available, minCliVersion } = loaded;
  const source =
    request.registry === undefined
      ? loaded.source
      : relative(resolvePath(request.directory), resolvePath(request.registry));
  const resolved = resolve(
    { modules: request.modules },
    available.map((module) => module.manifest),
  );
  if (!resolved.ok) {
    throw fromResolveError(resolved.error);
  }
  const manifests: ModuleManifest[] = resolved.modules.map((module) => module.manifest);
  const answers = completeAnswers(parseAnswers(request.answers, manifests), manifests);
  const formatter = formatterForSelection({ catalog: registry.currentCatalog, modules: manifests });
  const built = await buildProject({
    selection: request.modules,
    available,
    answers,
    layout: request.layout,
    catalog: registry.currentCatalog,
    context: { now: new Date(), random: Math.random, env: request.env },
    registry: {
      name: registry.name,
      source,
      release: registry.release,
      minCliVersion,
    },
    ...(formatter === undefined ? {} : { formatter }),
  });
  if (!built.ok) {
    throw fromResolveError(built.error);
  }
  return { built, answers, moduleNames: manifests.map((manifest) => manifest.name) };
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
    const { built, answers, moduleNames } = await plan(request);
    const reproduce = reproduceCommand({
      directory: request.directory,
      layout: request.layout,
      modules: request.modules,
      answers,
      registry: request.registry,
      install: request.install,
    });
    const changes = built.plan.changes.map(toPlanChange);
    const base = {
      directory,
      layout: request.layout,
      modules: moduleNames,
      plan: { hash: built.plan.hash, changes },
      warnings: warningTexts(built.warnings),
      reproduce,
    };
    if (request.dryRun || request.diff) {
      return {
        ...base,
        applied: false,
        installed: false,
        ...(request.diff ? { diff: unifiedDiff(built.plan) } : {}),
      };
    }
    await apply(built.plan, built.lockfile, directory);
    if (request.install) {
      await runInstall(directory, request.env);
    }
    return { ...base, applied: true, installed: request.install };
  } catch (thrown) {
    throw toAokitError(thrown);
  }
}
