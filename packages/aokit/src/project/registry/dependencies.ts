import type { ModuleManifest } from "@aokit/module";
import { computeIntegrity, type Integrity } from "../../registry/integrity.ts";
import { adaptShadcnItem } from "../../registry/shadcn/adapt.ts";
import { type ShadcnItem, shadcnItemSchema } from "../../registry/shadcn/schema.ts";
import {
  type ModuleVersion,
  parseRegistrySource,
  type Registry,
  type RegistryCache,
  RegistryError,
  type RegistrySource,
} from "../../registry/index.ts";
import { sourceIdentity } from "../../trust/identity.ts";

/** How one `registryDependencies` entry addresses the item it names. */
type RegistryDependencyForm = "bare" | "namespaced" | "github" | "url" | "path";

/**
 * One parsed `registryDependencies` entry. `address` is the Module name for `bare` (scoped to the
 * owner's Registry) and `namespaced`, `github:owner/repo/item#ref` for `github`, and the entry as
 * written for `url` and `path`.
 */
export interface RegistryDependency {
  readonly form: RegistryDependencyForm;
  readonly address: string;
}

const itemNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const namespacedPattern = /^@[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const githubItemPattern =
  /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9][A-Za-z0-9._-]*)#([^\s#]+)$/;
export const githubAddressPattern = /^github:([^/]+)\/([^/]+)\/([^#]+)#(.+)$/;
export const urlEntryPattern = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const pathEntryPattern = /^(?:\.{1,2}\/|\/)/;

/**
 * Parses a `registryDependencies` entry of an item served by the Registry `owner.registry` into
 * one of the five address forms: a bare item name (same Registry), `@ns/item`,
 * `owner/repo/item#ref` (the `github:` transport, pinned to a sha40), an item URL and a local
 * path. Throws `REGISTRY_SOURCE_UNSUPPORTED` naming the entry for anything else.
 */
export function parseRegistryDependency(
  entry: string,
  owner: { registry: string },
): RegistryDependency {
  if (urlEntryPattern.test(entry)) {
    return { form: "url", address: entry };
  }
  if (pathEntryPattern.test(entry)) {
    return { form: "path", address: entry };
  }
  if (namespacedPattern.test(entry)) {
    return { form: "namespaced", address: entry };
  }
  const github = githubItemPattern.exec(entry);
  if (github !== null) {
    const [, repoOwner = "", repo = "", item = "", ref = ""] = github;
    return { form: "github", address: `github:${repoOwner}/${repo}/${item}#${ref}` };
  }
  if (itemNamePattern.test(entry)) {
    return { form: "bare", address: `@${owner.registry.replace(/^@/, "")}/${entry}` };
  }
  throw new RegistryError(
    "REGISTRY_SOURCE_UNSUPPORTED",
    `Registry "${owner.registry}" lists the registryDependencies entry "${entry}", which is not an item name, @namespace/item, owner/repo/item#ref, an item URL or a local path.`,
    "Report the item to its Registry maintainer.",
    { registry: owner.registry, module: entry },
  );
}

/** A capability segment: lowercase kebab-case, whatever the item or scope is spelled as. */
function capabilitySegment(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug === "" ? "x" : slug;
}

/** The capability an Adapted Module provides under its own name, `@scope/item`. */
function nameCapability(moduleName: string): string {
  const [scope = "", item = ""] = moduleName.replace(/^@/, "").split("/");
  return `shadcn:${capabilitySegment(scope)}:${capabilitySegment(item)}`;
}

/** The capability an item provides at a location: its Registry's trust identity plus its name. */
function locationCapability(identity: string, item: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(`${identity}/${item}`).digest("hex");
  return `shadcn-at:${digest.slice(0, 16)}`;
}

/** Splits an item URL `<base>/<item>.json` into its shadcn Registry and item name. */
export function itemUrl(address: string): { source: RegistrySource; item: string } {
  const url = new URL(address);
  const cut = url.pathname.lastIndexOf("/");
  const file = url.pathname.slice(cut + 1);
  if (!file.endsWith(".json") || url.search !== "" || url.hash !== "") {
    throw new RegistryError(
      "REGISTRY_SOURCE_UNSUPPORTED",
      `"${address}" is not the URL of a shadcn item JSON file.`,
      "Use the URL of one item, such as https://example.com/r/button.json.",
      { registry: address },
    );
  }
  const base = `${url.origin}${url.pathname.slice(0, cut)}`;
  const source = parseRegistrySource(`${base}/registry.json`, {
    projectDir: "/",
    bundledRegistryPath: "/",
  });
  return { source, item: decodeURIComponent(file.slice(0, -".json".length)) };
}

/** The capability a parsed dependency requires, the same its provider offers. */
function dependencyCapability(dependency: RegistryDependency): string {
  if (dependency.form === "bare" || dependency.form === "namespaced") {
    return nameCapability(dependency.address);
  }
  if (dependency.form === "github") {
    const [, owner = "", repo = "", item = ""] =
      githubAddressPattern.exec(dependency.address) ?? [];
    return locationCapability(sourceIdentity({ kind: "github", owner, repo, ref: "HEAD" }), item);
  }
  if (dependency.form === "url") {
    const { source, item } = itemUrl(dependency.address);
    return locationCapability(sourceIdentity(source), item);
  }
  return locationCapability(`path:${dependency.address}`, dependency.address);
}

/** The raw item of an Adapted Module and the `registryDependencies` it lists. */
export const itemDependencies = new WeakMap<ModuleVersion, readonly string[]>();

/** Where the raw item JSON of an Adapted Module is kept in the integrity cache. */
function itemRecordKey(moduleIntegrity: string): Integrity {
  return computeIntegrity(`aokit-shadcn-item\n${moduleIntegrity}`);
}

/**
 * The item `text` parses to when it adapts, under `scope` (and the git `sourceSha` it was read
 * at), to a Module of that integrity.
 */
function verifiedItem(
  text: string,
  scope: string,
  origin: string,
  sourceSha: string | undefined,
): { integrity: string; item: ShadcnItem } | undefined {
  try {
    const parsed = shadcnItemSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return undefined;
    const context =
      sourceSha === undefined ? { scope, source: origin } : { scope, source: origin, sourceSha };
    return { integrity: adaptShadcnItem(parsed.data, context).integrity, item: parsed.data };
  } catch {
    return undefined;
  }
}

/**
 * Wraps an opened shadcn Registry so each Adapted Module also provides its name (and location)
 * capability and requires the ones of its `registryDependencies`, which the Resolver then orders,
 * pulls in and checks for cycles. The raw item comes from this open's reads, else from its record
 * in the integrity cache, verified by adapting it again to the Module's integrity; the integrity
 * itself is never changed.
 */
export async function withRegistryDependencies(
  registry: Registry,
  captured: readonly string[],
  cache: RegistryCache,
  origin: string,
  sourceSha: string | undefined,
): Promise<Registry> {
  const items = new Map<string, ShadcnItem>();
  for (const text of captured) {
    const verified = verifiedItem(text, registry.name, origin, sourceSha);
    if (verified === undefined) continue;
    items.set(verified.integrity, verified.item);
    // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of records, written in order
    await cache.put(itemRecordKey(verified.integrity), { manifest: text, files: new Map() });
  }
  const itemOf = async (version: ModuleVersion): Promise<ShadcnItem | undefined> => {
    const known = items.get(version.integrity);
    if (known !== undefined) return known;
    const record = await cache.get(itemRecordKey(version.integrity)).catch(() => undefined);
    const verified =
      record === undefined
        ? undefined
        : verifiedItem(record.manifest, registry.name, origin, sourceSha);
    return verified?.integrity === version.integrity ? verified.item : undefined;
  };
  const isNamespace = registry.source.kind === "shadcn" && registry.source.namespace !== undefined;
  const augmented = new Map<string, Promise<ModuleVersion>>();
  const augment = async (name: string, version: string): Promise<ModuleVersion> => {
    const loaded = await registry.version(name, version);
    const item = await itemOf(loaded);
    const dependencies = item?.registryDependencies ?? [];
    const requires = dependencies.map((entry) =>
      dependencyCapability(parseRegistryDependency(entry, { registry: registry.name })),
    );
    const itemName = name.slice(name.indexOf("/") + 1);
    const provides = [
      nameCapability(name),
      ...(isNamespace ? [] : [locationCapability(sourceIdentity(registry.source), itemName)]),
    ];
    const manifest: ModuleManifest = {
      ...loaded.manifest,
      provides: [
        ...loaded.manifest.provides,
        ...provides.map((capability) => ({ capability, cardinality: { max: 1 } })),
      ],
      requires: [...new Set([...loaded.manifest.requires, ...requires])],
    };
    const wrapped: ModuleVersion = { ...loaded, manifest };
    itemDependencies.set(wrapped, dependencies);
    return wrapped;
  };
  return {
    ...registry,
    version(name, version) {
      const key = `${name}@${version}`;
      const known = augmented.get(key);
      if (known !== undefined) return known;
      const loading = augment(name, version);
      augmented.set(key, loading);
      loading.catch(() => augmented.delete(key));
      return loading;
    },
  };
}
