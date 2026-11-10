import type { ModuleManifest } from "@aokit/module";
import { compareCodepoints, orderTopologically } from "./order.ts";
import { suggestModuleName } from "./suggest.ts";
import type {
  ResolveError,
  ResolveFailure,
  ResolveIntent,
  ResolveOptions,
  ResolveResult,
  ResolveSelection,
  ResolveSuggestion,
  ResolveWarning,
  ResolvedModule,
  ResolvedModuleSource,
} from "./types.ts";

interface ParsedRequirement {
  readonly raw: string;
  readonly extensionPoint?: { readonly name: string; readonly range: string };
}

interface UnmetRequirement {
  readonly module: ModuleManifest;
  readonly requirement: ParsedRequirement;
  readonly rangeMismatch?: undefined | { readonly provider: string; readonly version: string };
  readonly candidates: readonly ModuleManifest[];
}

class ResolveAbort extends Error {
  readonly resolveError: ResolveError;

  constructor(resolveError: ResolveError) {
    super(resolveError.message);
    this.resolveError = resolveError;
  }
}

function parseRequirement(raw: string): ParsedRequirement {
  if (!raw.startsWith("ext:")) {
    return { raw };
  }
  const separator = raw.lastIndexOf("@");
  return {
    raw,
    extensionPoint: { name: raw.slice(4, separator), range: raw.slice(separator + 1) },
  };
}

function extensionVersions(manifest: ModuleManifest, name: string): readonly string[] {
  return manifest.extensionPoints
    .filter((point) => point.name === name)
    .map((point) => point.version);
}

function satisfiesRange(version: string, range: string): boolean {
  return Bun.semver.satisfies(version, range);
}

function provides(manifest: ModuleManifest, requirement: ParsedRequirement): boolean {
  if (requirement.extensionPoint === undefined) {
    return manifest.provides.some((entry) => entry.capability === requirement.raw);
  }
  const { name, range } = requirement.extensionPoint;
  return extensionVersions(manifest, name).some((version) => satisfiesRange(version, range));
}

function describeProvider(manifest: ModuleManifest, requirement: ParsedRequirement): string {
  if (requirement.extensionPoint !== undefined) {
    const { name } = requirement.extensionPoint;
    return `${manifest.name} (${extensionVersions(manifest, name)
      .map((version) => `${name}@${version}`)
      .join(", ")})`;
  }
  return `${manifest.name} (${manifest.provides.map((entry) => entry.capability).join(", ")})`;
}

function byName(left: ModuleManifest, right: ModuleManifest): number {
  return compareCodepoints(left.name, right.name);
}

function quotedList(names: readonly string[]): string {
  return names.map((name) => `"${name}"`).join(", ");
}

function describeRequirement(requirement: ParsedRequirement): string {
  return requirement.extensionPoint === undefined
    ? `capability "${requirement.raw}"`
    : `extension point "${requirement.raw.slice(4)}"`;
}

function oneProviderFix(
  intent: ResolveIntent,
  provider: string,
  selected: readonly string[],
): string {
  if (intent === "add") {
    return `aokit add ${provider}`;
  }
  const modules = [...selected, provider].toSorted(compareCodepoints).join(",");
  return `add "${provider}" to --modules, for example --modules ${modules}`;
}

function manyProvidersFix(
  intent: ResolveIntent,
  providers: readonly string[],
  selected: readonly string[],
): string {
  const first = providers[0] ?? "";
  if (intent === "add") {
    return `run aokit add with exactly one of ${quotedList(providers)}, for example aokit add ${first}`;
  }
  const modules = [...selected, first].toSorted(compareCodepoints).join(",");
  return `add exactly one of ${quotedList(providers)} to --modules, for example --modules ${modules}`;
}

function unknownModuleFix(name: string, known: readonly string[]): string {
  const suggestion = suggestModuleName(name, known);
  const listing = "run `aokit list` to see the available modules.";
  return suggestion === undefined ? listing : `did you mean "${suggestion}"? ${listing}`;
}

function describeUnmet(
  unmet: UnmetRequirement,
  intent: ResolveIntent,
  selected: readonly string[],
): ResolveError {
  const { module, requirement, candidates } = unmet;
  const what = describeRequirement(requirement);
  if (unmet.rangeMismatch !== undefined) {
    const { provider, version } = unmet.rangeMismatch;
    const extensionName = requirement.extensionPoint?.name ?? requirement.raw;
    return {
      code: "extension_point_unmet",
      message: `module "${module.name}" requires ${what} but "${provider}" provides ${version}.`,
      fix: `use a ${module.name} release that supports ${extensionName}@^${version.split(".")[0] ?? version}, or update ${provider}.`,
      module: module.name,
      capability: requirement.raw,
      providers: [provider],
    };
  }
  const code =
    requirement.extensionPoint === undefined ? "requirement_unmet" : "extension_point_unmet";
  if (candidates.length === 0) {
    return {
      code,
      message: `module "${module.name}" requires ${what} but no selected module provides it.`,
      fix: `select a module that provides ${what}.`,
      module: module.name,
      capability: requirement.raw,
    };
  }
  const providerNames = candidates.map((candidate) => candidate.name);
  const listing = candidates
    .map((candidate) => describeProvider(candidate, requirement))
    .join("; ");
  if (candidates.length === 1) {
    const [only] = providerNames;
    return {
      code,
      message: `module "${module.name}" requires ${what} but no selected module provides it.\n  providers: ${listing}`,
      fix: oneProviderFix(intent, only ?? "", selected),
      module: module.name,
      capability: requirement.raw,
      providers: providerNames,
    };
  }
  return {
    code: "requirement_ambiguous",
    message: `module "${module.name}" requires ${what} but no selected module provides it and ${candidates.length} modules could.\n  providers: ${providerNames.join(", ")}`,
    fix: manyProvidersFix(intent, providerNames, selected),
    module: module.name,
    capability: requirement.raw,
    providers: providerNames,
  };
}

function capabilityLimit(entry: ModuleManifest["provides"][number]): number {
  return entry.cardinality === "many" ? Number.POSITIVE_INFINITY : entry.cardinality.max;
}

function blockersOf(candidate: ModuleManifest, selected: readonly ModuleManifest[]): string[] {
  const blockers = new Set<string>();
  for (const entry of candidate.provides) {
    const holders = selected.filter((other) =>
      other.provides.some((held) => held.capability === entry.capability),
    );
    const limits = holders.flatMap((holder) =>
      holder.provides
        .filter((held) => held.capability === entry.capability)
        .map((held) => capabilityLimit(held)),
    );
    if (holders.length + 1 > Math.min(capabilityLimit(entry), ...limits)) {
      for (const holder of holders) blockers.add(holder.name);
    }
  }
  for (const other of selected) {
    const conflicting =
      candidate.conflicts.includes(other.name) ||
      other.conflicts.includes(candidate.name) ||
      other.provides.some((held) => candidate.conflicts.includes(held.capability)) ||
      candidate.provides.some((held) => other.conflicts.includes(held.capability));
    if (conflicting) blockers.add(other.name);
  }
  return [...blockers].toSorted(compareCodepoints);
}

interface UnmetAssessment {
  readonly unmet: UnmetRequirement;
  readonly blockers: readonly string[];
  readonly unsatisfiable: boolean;
}

function assessUnmet(
  unmet: UnmetRequirement,
  selected: readonly ModuleManifest[],
): UnmetAssessment {
  if (unmet.rangeMismatch !== undefined || unmet.candidates.length === 0) {
    return { unmet, blockers: [], unsatisfiable: true };
  }
  const perCandidate = unmet.candidates.map((candidate) => blockersOf(candidate, selected));
  const blocked = perCandidate.every((blockers) => blockers.length > 0);
  return {
    unmet,
    blockers: blocked ? [...new Set(perCandidate.flat())].toSorted(compareCodepoints) : [],
    unsatisfiable: blocked,
  };
}

function describeAssessment({ unmet, blockers }: UnmetAssessment): string {
  const what = describeRequirement(unmet.requirement);
  if (unmet.rangeMismatch !== undefined) {
    const { provider, version } = unmet.rangeMismatch;
    return `${what}: "${provider}" provides ${version}`;
  }
  if (unmet.candidates.length === 0) {
    return `${what}: no module provides it`;
  }
  const names = unmet.candidates.map((candidate) => candidate.name);
  const listing = names.length === 1 ? quotedList(names) : `one of ${quotedList(names)}`;
  const note = blockers.length === 0 ? "" : ` (cannot be added alongside ${quotedList(blockers)})`;
  return `${what}: provided by ${listing}${note}`;
}

function describeAllUnmet(
  group: readonly UnmetRequirement[],
  intent: ResolveIntent,
  selected: readonly string[],
  pool: readonly ModuleManifest[],
): ResolveError {
  const [head] = group;
  const moduleName = head?.module.name ?? "";
  const assessments = group.map((unmet) => assessUnmet(unmet, pool));
  const requirements = group.map((unmet) => unmet.requirement.raw);
  const message = `module "${moduleName}" has ${group.length} unmet requirements:\n${assessments
    .map((assessment) => `  - ${describeAssessment(assessment)}`)
    .join("\n")}`;
  const providers = [
    ...new Set(
      group.flatMap((unmet) =>
        (unmet.candidates.length === 1 ? unmet.candidates : []).map((c) => c.name),
      ),
    ),
  ].toSorted(compareCodepoints);
  const stuck = assessments.some((assessment) => assessment.unsatisfiable);
  const base = { message, module: moduleName, requirements, providers };
  if (!stuck) {
    const choices = group
      .filter((unmet) => unmet.candidates.length > 1)
      .map((unmet) => `one of ${quotedList(unmet.candidates.map((candidate) => candidate.name))}`);
    const needed = [...providers.map((name) => `"${name}"`), ...choices].join(", ");
    const example = [...selected, ...providers].toSorted(compareCodepoints).join(",");
    const fix =
      intent === "add"
        ? `run aokit add with ${needed}, for example aokit add ${providers.join(" ")}`
        : `add ${needed} to --modules, for example --modules ${example}`;
    const ambiguous = group.every((unmet) => unmet.candidates.length > 1);
    return { ...base, code: ambiguous ? "requirement_ambiguous" : "requirement_unmet", fix };
  }
  const blockers = [...new Set(assessments.flatMap((assessment) => assessment.blockers))].toSorted(
    compareCodepoints,
  );
  const needs = group
    .map((unmet) => {
      const [first] = unmet.candidates;
      const by = unmet.candidates.length === 1 && first !== undefined ? ` (${first.name})` : "";
      return `${unmet.requirement.raw}${by}`;
    })
    .join(" plus ");
  const clash =
    blockers.length === 0
      ? "no selection of catalog modules satisfies all of them"
      : `${quotedList(blockers)} cannot be combined with the modules that provide them`;
  const retryModules = [...selected.filter((name) => !blockers.includes(name)), ...providers]
    .toSorted(compareCodepoints)
    .join(",");
  const retry =
    blockers.length === 0
      ? ""
      : intent === "add"
        ? ` Remove ${quotedList(blockers)} from the Project first, then run aokit add ${providers.join(" ")}.`
        : ` Drop ${quotedList(blockers)}, for example --modules ${retryModules}.`;
  const fix = `"${moduleName}" currently needs ${needs}, and ${clash}.${retry} Run \`aokit list\` to see the available modules, and see docs/architecture/module-catalog.md.`;
  return { ...base, code: "requirement_unmet", fix };
}

class Resolution {
  private readonly index: ReadonlyMap<string, ModuleManifest>;
  private readonly registry: readonly ModuleManifest[];
  private readonly selected = new Map<string, ResolvedModule>();
  readonly warnings: ResolveWarning[] = [];
  readonly suggestions: ResolveSuggestion[] = [];

  constructor(registryIndex: readonly ModuleManifest[]) {
    const index = new Map<string, ModuleManifest>();
    for (const manifest of registryIndex) {
      if (!index.has(manifest.name)) {
        index.set(manifest.name, manifest);
      }
    }
    this.index = index;
    this.registry = [...index.values()].toSorted(byName);
  }

  seed(names: readonly string[], source: ResolvedModuleSource): void {
    for (const name of [...names].toSorted(compareCodepoints)) {
      const manifest = this.index.get(name);
      if (manifest === undefined) {
        throw new ResolveAbort({
          code: "unknown_module",
          message: `module "${name}" is not in the registry index.`,
          fix: unknownModuleFix(name, [...this.index.keys()]),
          module: name,
        });
      }
      if (!this.selected.has(name)) {
        this.selected.set(name, { name, manifest, source });
      }
    }
  }

  private selectedManifests(): readonly ModuleManifest[] {
    return [...this.selected.values()].map((entry) => entry.manifest).toSorted(byName);
  }

  private collectUnmet(): readonly UnmetRequirement[] {
    const pool = this.selectedManifests();
    const unmet: UnmetRequirement[] = [];
    for (const module of pool) {
      for (const raw of [...module.requires].toSorted(compareCodepoints)) {
        const requirement = parseRequirement(raw);
        const others = pool.filter((other) => other.name !== module.name);
        if (others.some((other) => provides(other, requirement))) {
          continue;
        }
        const mismatch = this.findRangeMismatch(others, requirement);
        const candidates = this.registry.filter(
          (candidate) => !this.selected.has(candidate.name) && provides(candidate, requirement),
        );
        unmet.push({ module, requirement, rangeMismatch: mismatch, candidates });
      }
    }
    return unmet;
  }

  private findRangeMismatch(
    others: readonly ModuleManifest[],
    requirement: ParsedRequirement,
  ): UnmetRequirement["rangeMismatch"] {
    if (requirement.extensionPoint === undefined) {
      return undefined;
    }
    for (const other of others) {
      const [version] = extensionVersions(other, requirement.extensionPoint.name);
      if (version !== undefined) {
        return { provider: other.name, version };
      }
    }
    return undefined;
  }

  expand(acceptSuggestions: boolean): void {
    if (acceptSuggestions) {
      for (;;) {
        const addable = this.collectUnmet().find(
          (unmet) => unmet.rangeMismatch === undefined && unmet.candidates.length === 1,
        );
        const [candidate] = addable?.candidates ?? [];
        if (addable === undefined || candidate === undefined) {
          break;
        }
        this.selected.set(candidate.name, {
          name: candidate.name,
          manifest: candidate,
          source: "suggested",
        });
        this.suggestions.push({
          module: candidate.name,
          requiredBy: addable.module.name,
          requirement: addable.requirement.raw,
          applied: true,
        });
      }
    }
  }

  checkCardinality(): void {
    const byCapability = new Map<string, { module: string; max: number | "many" }[]>();
    for (const { manifest } of this.selected.values()) {
      for (const entry of manifest.provides) {
        const list = byCapability.get(entry.capability) ?? [];
        list.push({
          module: manifest.name,
          max: entry.cardinality === "many" ? "many" : entry.cardinality.max,
        });
        byCapability.set(entry.capability, list);
      }
    }
    for (const capability of [...byCapability.keys()].toSorted(compareCodepoints)) {
      const declared = (byCapability.get(capability) ?? []).toSorted((left, right) =>
        compareCodepoints(left.module, right.module),
      );
      const limits = declared.map((entry) =>
        entry.max === "many" ? Number.POSITIVE_INFINITY : entry.max,
      );
      const strictest = Math.min(...limits);
      if (declared.length > 1 && new Set(limits).size > 1) {
        this.warnings.push({
          code: "cardinality_disagreement",
          message: `modules ${quotedList(declared.map((entry) => entry.module))} declare different cardinality for capability "${capability}"; the stricter one (${strictest === Number.POSITIVE_INFINITY ? "many" : `max ${strictest}`}) wins.`,
          capability,
        });
      }
      if (declared.length > strictest) {
        const names = declared.map((entry) => entry.module);
        throw new ResolveAbort({
          code: "cardinality_exceeded",
          message: `capability "${capability}" allows at most ${strictest} provider${strictest === 1 ? "" : "s"}, but ${declared.length} are selected: ${names.join(", ")}.`,
          fix: "remove one of them from the selection.",
          capability,
          providers: names,
        });
      }
    }
  }

  checkConflicts(): void {
    const pool = this.selectedManifests();
    for (const module of pool) {
      for (const target of [...module.conflicts].toSorted(compareCodepoints)) {
        const others = pool.filter((other) => other.name !== module.name);
        if (others.some((other) => other.name === target)) {
          throw new ResolveAbort({
            code: "module_conflict",
            message: `module "${module.name}" conflicts with module "${target}" (declared in the conflicts of "${module.name}").`,
            fix: `choose one, or remove "${target}".`,
            module: module.name,
            providers: [target],
          });
        }
        const provider = others.find((other) =>
          other.provides.some((entry) => entry.capability === target),
        );
        if (provider !== undefined) {
          throw new ResolveAbort({
            code: "module_conflict",
            message: `module "${module.name}" conflicts with capability "${target}", provided by module "${provider.name}".`,
            fix: `choose one, or remove "${provider.name}".`,
            module: module.name,
            capability: target,
            providers: [provider.name],
          });
        }
      }
    }
  }

  checkRequirements(intent: ResolveIntent): void {
    const pending = this.collectUnmet();
    for (const unmet of pending) {
      const [only] = unmet.candidates;
      if (
        unmet.rangeMismatch === undefined &&
        unmet.candidates.length === 1 &&
        only !== undefined
      ) {
        this.suggestions.push({
          module: only.name,
          requiredBy: unmet.module.name,
          requirement: unmet.requirement.raw,
          applied: false,
        });
      }
    }
    const [first] = pending;
    if (first !== undefined) {
      const group = pending.filter((unmet) => unmet.module.name === first.module.name);
      const chosen = [...this.selected.values()]
        .filter((entry) => entry.source === "selected")
        .map((entry) => entry.name)
        .toSorted(compareCodepoints);
      const error =
        group.length > 1
          ? describeAllUnmet(group, intent, chosen, this.selectedManifests())
          : describeUnmet(first, intent, chosen);
      throw new ResolveAbort(error);
    }
  }

  warnInertOverrides(): void {
    const pool = this.selectedManifests();
    for (const module of pool) {
      for (const entry of module.override) {
        const item = "file" in entry ? entry.file : entry.op;
        const produced = pool
          .filter((other) => other.name !== module.name)
          .some((other) => producedItems(other).has(item));
        if (!produced) {
          this.warnings.push({
            code: "override_inert",
            message: `module "${module.name}" overrides "${item}" but no other selected module produces it, so the override has no effect.`,
            module: module.name,
          });
        }
      }
    }
  }

  order(): readonly ResolvedModule[] {
    const pool = this.selectedManifests();
    const dependencies = new Map<string, Set<string>>();
    for (const module of pool) {
      const after = new Set<string>();
      for (const raw of module.requires) {
        const requirement = parseRequirement(raw);
        for (const other of pool) {
          if (other.name !== module.name && provides(other, requirement)) {
            after.add(other.name);
          }
        }
      }
      dependencies.set(module.name, after);
    }
    const outcome = orderTopologically(
      pool.map((module) => module.name),
      dependencies,
    );
    if (outcome.kind === "cycle") {
      throw new ResolveAbort({
        code: "dependency_cycle",
        message: `modules form a dependency cycle: ${outcome.cycle.join(" requires ")}.`,
        fix: `remove one of the requires between ${quotedList([...new Set(outcome.cycle)])}.`,
        providers: [...new Set(outcome.cycle)],
      });
    }
    return outcome.names.flatMap((name) => {
      const entry = this.selected.get(name);
      return entry === undefined ? [] : [entry];
    });
  }
}

function producedItems(manifest: ModuleManifest): ReadonlySet<string> {
  const items = new Set<string>();
  for (const file of manifest.files) {
    items.add(`${file.target}:${file.to}`);
  }
  for (const op of manifest.ops) {
    items.add(op.op);
    const location = "extensionPoint" in op ? op.extensionPoint : "file" in op ? op.file : "";
    items.add(`${op.op}:${"target" in op ? op.target : ""}:${location ?? ""}`);
  }
  return items;
}

/**
 * Resolves a selection against a registry index into the canonical ordered Modules.
 * Pure: no I/O. Modules in `selection.locked` count as selected. A missing requirement with
 * exactly one provider is returned as a suggestion and only applied with `acceptSuggestions`.
 * `options.intent` words the fix of a missing dependency (`--modules` for `create`, `aokit add`
 * for `add`) and defaults to `add`.
 */
export function resolve(
  selection: ResolveSelection,
  registryIndex: readonly ModuleManifest[],
  options: ResolveOptions = {},
): ResolveResult {
  const resolution = new Resolution(registryIndex);
  try {
    resolution.seed(selection.modules, "selected");
    resolution.seed(selection.locked ?? [], "locked");
    resolution.expand(options.acceptSuggestions === true);
    resolution.checkCardinality();
    resolution.checkConflicts();
    resolution.checkRequirements(options.intent ?? "add");
    resolution.warnInertOverrides();
    const modules = resolution.order();
    return {
      ok: true,
      modules,
      warnings: resolution.warnings,
      suggestions: resolution.suggestions,
    };
  } catch (error) {
    if (error instanceof ResolveAbort) {
      const failure: ResolveFailure = {
        ok: false,
        error: error.resolveError,
        warnings: resolution.warnings,
        suggestions: resolution.suggestions,
      };
      return failure;
    }
    throw error;
  }
}
