import { join, resolve as resolvePath } from "node:path";
import type { ModuleManifest } from "@aokit/module";
import { z } from "zod";
import { apply } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import { registerShutdownHook } from "../cli/shutdown.ts";
import { Vfs, type EngineModule } from "../engine/index.ts";
import type { LayoutName } from "../engine/layout.ts";
import type { PlanChange } from "../engine/plan.ts";
import { formatterForSelection } from "../format/index.ts";
import { buildProject } from "../pipeline/index.ts";
import { readLocalRegistry, type LocalRegistry } from "../registry/index.ts";
import { resolve } from "../resolver/resolve.ts";
import { completeAnswers, parseAnswers } from "./answers.ts";
import { unifiedDiff } from "./diff.ts";
import { fromResolveError, toAokitError } from "./errors.ts";
import { reproduceCommand } from "./reproduce.ts";
import { checkTarget } from "./target.ts";

const bundledRegistry = join(import.meta.dir, "..", "..", "..", "..", "registry");
const registryIndexMinimum = z.object({ minCliVersion: z.string().min(1) });

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

function toEngineModule(name: string, registry: LocalRegistry): EngineModule {
  const entry = registry.modules.get(name);
  if (entry === undefined) {
    throw new AokitError(
      "INTERNAL",
      `Module ${name} vanished from the Registry`,
      "report the issue",
    );
  }
  return {
    manifest: entry.manifest,
    readFile(from) {
      const content = entry.files.get(from);
      if (content === undefined) {
        throw new AokitError("INTERNAL", `Module ${name} has no file ${from}`, "report the issue");
      }
      return content;
    },
  };
}

async function readMinCliVersion(registryPath: string): Promise<string> {
  const index: unknown = await Bun.file(join(registryPath, "index.json")).json();
  return registryIndexMinimum.parse(index).minCliVersion;
}

function installFailure(directory: string, detail: string): AokitError {
  return new AokitError(
    "IO_ERROR",
    `the Project was created in \`${directory}\` but \`bun install\` failed${detail === "" ? "" : `: ${detail}`}`,
    `run \`bun install\` in \`${directory}\` to finish the setup`,
  );
}

async function runInstall(
  directory: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  let child;
  try {
    child = Bun.spawn(["bun", "install"], {
      cwd: directory,
      env: { ...env },
      stdout: "ignore",
      stderr: "pipe",
    });
  } catch (error) {
    throw installFailure(directory, error instanceof Error ? error.message : String(error));
  }
  const unregister = registerShutdownHook(() => {
    child.kill();
  });
  try {
    const [stderrText, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      const tail = stderrText.trim().split("\n").slice(-5).join("\n");
      throw installFailure(directory, `exit code ${exitCode}${tail === "" ? "" : `\n${tail}`}`);
    }
  } finally {
    unregister();
  }
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
  const registryPath =
    request.registry === undefined ? bundledRegistry : resolvePath(request.registry);
  const registry = await readLocalRegistry(registryPath, { cliVersion: request.version });
  const available = [...registry.modules.keys()]
    .toSorted()
    .map((name) => toEngineModule(name, registry));
  const resolved = resolve(
    { modules: request.modules },
    available.map((module) => module.manifest),
  );
  if (!resolved.ok) {
    throw fromResolveError(resolved.error);
  }
  const manifests: ModuleManifest[] = resolved.modules.map((module) => module.manifest);
  const answers = completeAnswers(parseAnswers(request.answers, manifests), manifests);
  const formatter = formatterForSelection({ catalog: registry.catalog, modules: manifests });
  const built = await buildProject({
    selection: request.modules,
    available,
    answers,
    layout: request.layout,
    catalog: registry.catalog,
    context: { now: new Date(), random: Math.random, env: request.env },
    registry: {
      name: registry.name,
      source: request.registry ?? "bundled",
      release: registry.release,
      minCliVersion: await readMinCliVersion(registryPath),
    },
    base: Vfs.empty(),
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
        ...(request.diff
          ? { diff: built.plan.changes.map((change) => unifiedDiff(change)).join("\n") }
          : {}),
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
