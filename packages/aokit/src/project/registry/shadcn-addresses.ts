import { AokitError } from "../../cli/envelope.ts";
import type { Lockfile } from "../../lockfile/schema.ts";
import {
  formatRegistrySource,
  type ModuleVersion,
  type Registry,
  RegistryError,
  type RegistrySource,
} from "../../registry/index.ts";
import { ensureTrusted, type TrustDecision } from "../../trust/gate.ts";
import { sourceIdentity } from "../../trust/identity.ts";
import {
  cacheFor,
  clash,
  type LoadProjectRegistriesOptions,
  type LockfileRegistries,
  pinnedIntegrities,
  type ProjectRegistries,
  recordedSource,
  requiredRegistry,
} from "./context.ts";
import {
  githubAddressPattern,
  githubItemPattern,
  itemDependencies,
  itemUrl,
  namespacedPattern,
  parseRegistryDependency,
  type RegistryDependency,
  urlEntryPattern,
} from "./dependencies.ts";
import { openSource } from "./open-source.ts";

/** A requested Module and the Registry key it is read from. */
interface AddressedModule {
  readonly key: string;
  readonly version: ModuleVersion;
}

/** What {@link openShadcnAddresses} found: the grown Registry set, names and Adapted Modules. */
export interface ShadcnAddressing {
  /** The Registries of the run, with every shadcn Registry an address or dependency needed. */
  readonly set: ProjectRegistries;
  /** The requested entries as Module names: an item URL or `owner/repo/item#ref` becomes `@ns/item`. */
  readonly names: readonly string[];
  /** The requested Adapted Modules and their `registryDependencies`, transitively, newest versions. */
  readonly modules: readonly AddressedModule[];
}

function scopeOf(registry: Pick<Registry, "name">): string {
  return registry.name.replace(/^@/, "");
}

function isShadcnRegistry(registry: Registry): boolean {
  return Object.values(registry.index.modules).every((entry) =>
    Object.keys(entry.versions).every((version) => version.startsWith("0.0.0-shadcn.")),
  );
}

function dependencyCycle(cycle: readonly string[]): AokitError {
  return new AokitError(
    "CAPABILITY_CONFLICT",
    `shadcn items depend on each other through registryDependencies: ${cycle.join(" -> ")}.`,
    `Ask the Registry maintainer to break the cycle between ${[...new Set(cycle)].join(" and ")}; aokit installs no item that depends on itself.`,
    { modules: [...new Set(cycle)] },
  );
}

function dependencyNotServed(
  dependency: RegistryDependency,
  target: AddressedModuleName,
  dependent: string,
): RegistryError {
  const served = dependency.address === target.name ? "" : ` (Module "${target.name}")`;
  return new RegistryError(
    "REGISTRY_MODULE_NOT_FOUND",
    `"${dependent}" lists the registryDependencies item "${dependency.address}"${served}, which its Registry does not serve.`,
    `Ask the maintainer of "${dependent}" to publish "${dependency.address}" or drop it from registryDependencies.`,
    { registry: target.key, module: target.name, path: dependency.address },
  );
}

function pathUnsupported(address: string): RegistryError {
  return new RegistryError(
    "REGISTRY_SOURCE_UNSUPPORTED",
    `The local shadcn item "${address}" cannot be read: a local path is read only as an aokit Registry directory.`,
    "Serve the item over http(s), or publish it under a Namespace, and depend on that address instead.",
    { registry: address },
  );
}

/**
 * Resolves the shadcn addresses among `requested` (`@ns/item`, an item URL, `owner/repo/item#ref`)
 * to Module names, opening the shadcn Registry each one needs, then walks the
 * `registryDependencies` of every requested Adapted Module, opening each other Registry they name.
 * Every Registry this opens goes through the trust gate on its own, and is added to `set` with its
 * Lockfile entry; a Registry already in `set` is opened again to read the extra items. Plain names
 * are kept as they are. A dependency cycle fails with `CAPABILITY_CONFLICT` naming the items.
 */
export async function openShadcnAddresses(
  set: ProjectRegistries,
  lockfile: LockfileRegistries,
  requested: readonly string[],
  options: LoadProjectRegistriesOptions,
): Promise<ShadcnAddressing> {
  const projectDir = options.projectDir ?? process.cwd();
  const cache = cacheFor(options.adapters);
  const registries = new Map(set.registries);
  const entries: Lockfile["registries"] = { ...set.entries };
  const decisions: TrustDecision[] = [];
  const trustOpened = async (key: string): Promise<void> => {
    const [decision] = await ensureTrusted([requiredRegistry(registries, key)], {
      trustFlags: options.trustFlags,
      lockfile,
      interactive: options.interactive,
      ...(options.adapters?.prompt === undefined ? {} : { prompt: options.adapters.prompt }),
      ...(options.adapters?.userConfig === undefined
        ? {}
        : { userConfig: options.adapters.userConfig }),
      ...(options.adapters?.env === undefined ? {} : { env: options.adapters.env }),
    });
    if (decision === undefined) return;
    decisions.push(decision);
    const entry = entries[key];
    if (entry !== undefined && decision.lockfileTrusted) entries[key] = { ...entry, trusted: true };
  };
  const keyFor = (source: RegistrySource): string | undefined => {
    const identity = sourceIdentity(source);
    return [...registries.keys()].find((key) => {
      const registry = requiredRegistry(registries, key);
      if (source.kind === "shadcn" && source.namespace !== undefined) {
        return registry.source.kind === "shadcn" && registry.source.namespace === source.namespace;
      }
      return sourceIdentity(registry.source) === identity;
    });
  };
  const serve = async (source: RegistrySource, item: string): Promise<AddressedModuleName> => {
    const known = keyFor(source);
    if (known !== undefined) {
      const registry = requiredRegistry(registries, known);
      const name = `@${scopeOf(registry)}/${item}`;
      if (registry.selectableVersions(name).length > 0) return { key: known, name };
      const items = [
        ...Object.keys(registry.index.modules).map((module) =>
          module.slice(module.indexOf("/") + 1),
        ),
        item,
      ];
      registries.set(
        known,
        await openSource(registry.source, options, cache, {
          pinned: pinnedIntegrities(lockfile, known),
          items,
        }),
      );
      return { key: known, name };
    }
    const registry = await openSource(source, options, cache, { items: [item] });
    const rival = registries.get(registry.name);
    if (rival !== undefined) {
      throw clash(
        registry.name,
        formatRegistrySource(rival.source),
        formatRegistrySource(registry.source),
      );
    }
    registries.set(registry.name, registry);
    entries[registry.name] = {
      source: recordedSource(registry, projectDir),
      release: registry.release,
      minCliVersion: registry.index.minCliVersion,
    };
    await trustOpened(registry.name);
    return { key: registry.name, name: `@${scopeOf(registry)}/${item}` };
  };
  const locate = async (dependency: RegistryDependency): Promise<AddressedModuleName> => {
    if (dependency.form === "bare" || dependency.form === "namespaced") {
      const [scope = "", item = ""] = dependency.address.slice(1).split("/");
      const owner = [...registries.entries()].find(
        ([, registry]) => scopeOf(registry) === scope && isShadcnRegistry(registry),
      );
      return serve(owner?.[1].source ?? { kind: "shadcn", namespace: `@${scope}`, url: "" }, item);
    }
    if (dependency.form === "url") {
      const { source, item } = itemUrl(dependency.address);
      return serve(source, item);
    }
    if (dependency.form === "github") {
      const [, owner = "", repo = "", item = "", ref = ""] =
        githubAddressPattern.exec(dependency.address) ?? [];
      return serve({ kind: "github", owner, repo, ref }, item);
    }
    throw pathUnsupported(dependency.address);
  };
  const names: string[] = [];
  const roots: AddressedModuleName[] = [];
  for (const entry of requested) {
    const shadcn =
      urlEntryPattern.test(entry) || namespacedPattern.test(entry) || githubItemPattern.test(entry);
    if (!shadcn) {
      names.push(entry);
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- Registries open one at a time, in order
    const target = await locate(parseRegistryDependency(entry, { registry: "" }));
    names.push(target.name);
    roots.push(target);
  }
  const modules = new Map<string, AddressedModule>();
  const visit = async (
    target: AddressedModuleName,
    path: readonly string[],
    dependency?: RegistryDependency,
  ): Promise<void> => {
    if (path.includes(target.name)) throw dependencyCycle([...path, target.name]);
    if (modules.has(target.name) || lockfile.modules?.[target.name] !== undefined) return;
    const registry = requiredRegistry(registries, target.key);
    const newest = registry.selectableVersions(target.name).at(-1);
    if (newest === undefined) {
      const dependent = path.at(-1);
      if (dependency === undefined || dependent === undefined) return;
      throw dependencyNotServed(dependency, target, dependent);
    }
    const version = await registry.version(target.name, newest);
    modules.set(target.name, { key: target.key, version });
    for (const entry of itemDependencies.get(version) ?? []) {
      const parsed = parseRegistryDependency(entry, { registry: registry.name });
      // oxlint-disable-next-line eslint/no-await-in-loop -- a depth-first walk, in item order
      const located = await locate(parsed);
      // oxlint-disable-next-line eslint/no-await-in-loop -- a depth-first walk, in item order
      await visit(located, [...path, target.name], parsed);
    }
  };
  for (const root of roots) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a depth-first walk, in request order
    await visit(root, []);
  }
  return {
    set: { ...set, registries, entries, decisions: [...set.decisions, ...decisions] },
    names,
    modules: [...modules.values()],
  };
}

/** A Module name and the Registry key it is read from, before it is read. */
interface AddressedModuleName {
  readonly key: string;
  readonly name: string;
}
