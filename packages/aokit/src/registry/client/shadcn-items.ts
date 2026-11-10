import { type ModuleManifest, stableStringify } from "@aokit/module";
import type { UserConfig } from "../../config/user-config.ts";
import { RegistryError } from "../errors.ts";
import { computeIntegrity, computeModuleIntegrity, type Integrity } from "../integrity.ts";
import {
  expandNamespaceRequest,
  loadNamespaceEnvironment,
  resolveNamespace,
} from "../namespace.ts";
import { type RegistryTransport, urlTransport } from "../remote.ts";
import {
  type RegistryIndex,
  registryIndexSchemaUrl,
  supportedRegistrySchemaVersion,
} from "../schema.ts";
import { type AdaptedModule, adaptShadcnItem } from "../shadcn/adapt.ts";
import { shadcnItemSchema, shadcnRegistrySchema } from "../shadcn/schema.ts";
import type { RegistrySource } from "../source.ts";
import {
  byCodepoint,
  type CachedModuleVersion,
  type ModuleVersion,
  type OpenRegistryContext,
  parseJson,
  type RegistryCache,
} from "./common.ts";
import { parseModuleManifest } from "./module-version.ts";

export const shadcnIndexFile = "registry.json";
export const shadcnRelease = "shadcn";
const shadcnMinCliVersion = "0.0.0";
export const scopePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const namespaceProbeItem = "aokit-item-name";
export const itemChangedFix =
  "Run `aokit update` to move it to the version the Registry serves now.";

type TemplateEnvironment = Readonly<Record<string, string | undefined>>;

/** Every `${VAR}` reads as set, so a Namespace resolves without expanding or checking anything. */
const permissiveEnvironment: TemplateEnvironment = new Proxy(
  {},
  { get: () => "", has: () => true },
);

/** How one shadcn item is fetched: the transport that serves it and the path it is read at. */
export interface ItemLocation {
  readonly transport: RegistryTransport;
  readonly path: string;
}

/** The outcome of reading one shadcn item at open: adapted, absent upstream, or failed. */
export type ItemRead =
  | { readonly kind: "served"; readonly module: AdaptedModule }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly error: unknown };

/** A Namespace as the user config (or the Lockfile) declares it, placeholders kept. */
interface NamespaceDeclaration {
  readonly template: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What `registry.json` tells: the declared name and the item names. */
interface ShadcnIndex {
  readonly name?: string;
  readonly items: readonly string[];
}

export type ShadcnSource = Extract<RegistrySource, { kind: "shadcn" }>;

export function asIntegrity(value: string | undefined): Integrity | undefined {
  return value !== undefined && isIntegrity(value) ? value : undefined;
}

function isIntegrity(value: string): value is Integrity {
  return /^sha256-[0-9a-f]{64}$/.test(value);
}

function isOffline(error: unknown): boolean {
  return (
    error instanceof RegistryError &&
    error.code === "REGISTRY_FETCH_FAILED" &&
    error.data.status === undefined
  );
}

export function hostScope(url: string): string {
  const slug = new URL(url).hostname
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `r-${slug}`;
}

export function scopeOf(moduleName: string): string | undefined {
  return /^@([^/]+)\//.exec(moduleName)?.[1];
}

/** Splits a `name@version` key of the Lockfile into Module name and version. */
export function splitModuleKey(key: string): { name: string; version: string } | undefined {
  const at = key.lastIndexOf("@");
  return at <= 0 ? undefined : { name: key.slice(0, at), version: key.slice(at + 1) };
}

/**
 * The template and headers of a Namespace: the user config entry (or the built-in one), else the
 * template the Lockfile recorded, sent without headers. Nothing is expanded here.
 */
export function declareNamespace(
  namespace: string,
  recordedTemplate: string,
  userConfig: UserConfig,
): NamespaceDeclaration {
  try {
    const target = resolveNamespace(
      `${namespace}/${namespaceProbeItem}`,
      userConfig,
      permissiveEnvironment,
    );
    return {
      template: target.urlTemplate.replaceAll(namespaceProbeItem, "{name}"),
      headers: target.headers,
    };
  } catch (error) {
    if (
      error instanceof RegistryError &&
      error.code === "REGISTRY_NOT_FOUND" &&
      recordedTemplate !== ""
    ) {
      return { template: recordedTemplate, headers: {} };
    }
    throw error;
  }
}

function splitParent(url: string): { base: string; file: string; suffix: string } {
  const queryStart = url.search(/[?#]/);
  const pathPart = queryStart === -1 ? url : url.slice(0, queryStart);
  const cut = pathPart.lastIndexOf("/");
  return {
    base: pathPart.slice(0, cut),
    file: pathPart.slice(cut + 1),
    suffix: queryStart === -1 ? "" : url.slice(queryStart),
  };
}

/** Where a Namespace item is read: its expanded URL, with headers only for the Namespace origin. */
export function namespaceItemLocation(
  namespace: string,
  declaration: NamespaceDeclaration,
  item: string,
  env: TemplateEnvironment,
  fetchImpl: typeof fetch,
): ItemLocation {
  const urlTemplate = declaration.template.replaceAll("{name}", encodeURIComponent(item));
  const request = expandNamespaceRequest(
    { namespace, item, urlTemplate, headers: { ...declaration.headers } },
    env,
  );
  const expanded = splitParent(request.url);
  const shown = splitParent(urlTemplate);
  return {
    transport: urlTransport(expanded.base, fetchImpl, {
      headers: request.headers,
      displayBase: shown.base,
      suffix: expanded.suffix,
      displaySuffix: shown.suffix,
    }),
    path: decodeURIComponent(expanded.file),
  };
}

function shadcnIndexInvalid(location: string, reason: string): RegistryError {
  return new RegistryError(
    "REGISTRY_INDEX_INVALID",
    `shadcn Registry index ${location} is invalid: ${reason}`,
    "Point --registry at a shadcn Registry that serves a valid registry.json.",
    { registry: location, path: location },
  );
}

function parseShadcnIndex(text: string, location: string): ShadcnIndex {
  const parsed = shadcnRegistrySchema.safeParse(
    parseJson(text, (reason) => shadcnIndexInvalid(location, reason)),
  );
  if (!parsed.success) {
    throw shadcnIndexInvalid(
      location,
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }
  return {
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
    items: parsed.data.items.map((item) => item.name),
  };
}

/** Reads `registry.json`; `undefined` when the network is unreachable, so a warm cache serves. */
export async function readShadcnIndex(
  transport: RegistryTransport,
  preRead: string | undefined,
): Promise<{ index: ShadcnIndex; text: string } | undefined> {
  const location = `${transport.location}/${shadcnIndexFile}`;
  let text = preRead;
  if (text === undefined) {
    try {
      text = await transport.read(shadcnIndexFile);
    } catch (error) {
      if (isOffline(error)) return undefined;
      throw error;
    }
  }
  if (text === undefined) {
    throw new RegistryError(
      "REGISTRY_NOT_FOUND",
      `No shadcn Registry index at ${location}.`,
      "Point --registry at a shadcn Registry that serves registry.json.",
      { registry: transport.location, path: location },
    );
  }
  return { index: parseShadcnIndex(text, location), text };
}

export async function readItem(
  location: ItemLocation,
  item: string,
  registryName: string,
  sourceSha: string | undefined,
  origin: string,
): Promise<ItemRead> {
  const text = await location.transport.read(location.path);
  if (text === undefined) {
    return { kind: "missing" };
  }
  const subject = `Registry "${registryName}" shadcn item ${item}`;
  const invalid = (reason: string): RegistryError =>
    new RegistryError(
      "REGISTRY_MANIFEST_INVALID",
      `${subject} is invalid: ${reason}`,
      "Report the item to its Registry maintainer.",
      { registry: registryName, module: item },
    );
  const parsed = shadcnItemSchema.safeParse(parseJson(text, invalid));
  if (!parsed.success) {
    throw invalid(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  if (parsed.data.name !== item) {
    throw new RegistryError(
      "REGISTRY_SUMMARY_MISMATCH",
      `${subject} is named differently: expected ${item}, actual ${parsed.data.name}.`,
      "Report the item to its Registry maintainer.",
      { registry: registryName, module: item, expected: item, actual: parsed.data.name },
    );
  }
  try {
    return {
      kind: "served",
      module: adaptShadcnItem(parsed.data, {
        scope: registryName,
        source: origin,
        ...(sourceSha === undefined ? {} : { sourceSha }),
      }),
    };
  } catch (error) {
    if (error instanceof RegistryError) {
      throw new RegistryError(error.code, error.message, error.fix, {
        ...error.data,
        registry: registryName,
      });
    }
    throw error;
  }
}

export function cachedContent(module: AdaptedModule): CachedModuleVersion {
  return { manifest: stableStringify(module.manifest), files: module.files };
}

export function adaptedModuleVersion(
  name: string,
  version: string,
  manifest: ModuleManifest,
  files: ReadonlyMap<string, string>,
  integrity: Integrity,
  registryName: string,
): ModuleVersion {
  return {
    name,
    version,
    manifest,
    files: new Map(files),
    integrity,
    renames: {},
    migrationScript: (script) => {
      throw new RegistryError(
        "REGISTRY_FILE_MISSING",
        `Adapted Module ${name}@${version} of Registry "${registryName}" ships no Migration script ${script}.`,
        "Adapted Modules are declarative; they carry no Migration.",
        { registry: registryName, module: `${name}@${version}`, path: script },
      );
    },
  };
}

/**
 * A cache hit for a recorded integrity, verified again: the integrity over its content, a valid
 * declarative manifest of the same name and version, and every file the manifest lists. Anything
 * else is ignored, as a miss.
 */
export async function readCachedAdapted(
  cache: RegistryCache,
  recorded: Integrity,
  name: string,
  version: string,
  registryName: string,
): Promise<ModuleVersion | undefined> {
  const cached = await cache.get(recorded).catch(() => undefined);
  if (cached === undefined || computeModuleIntegrity(cached.manifest, cached.files) !== recorded) {
    return undefined;
  }
  let manifest: ModuleManifest;
  try {
    manifest = parseModuleManifest(cached.manifest, `Adapted Module ${name}`, registryName);
  } catch {
    return undefined;
  }
  const declarative =
    manifest.name === name &&
    manifest.version === version &&
    manifest.migrations.length === 0 &&
    manifest.files.every((file) => cached.files.has(file.from));
  return declarative
    ? adaptedModuleVersion(name, version, manifest, cached.files, recorded, registryName)
    : undefined;
}

export function syntheticIndex(
  registryName: string,
  indexText: string,
  served: ReadonlyMap<string, AdaptedModule>,
): RegistryIndex {
  const modules: RegistryIndex["modules"] = {};
  for (const [moduleName, module] of [...served].toSorted(([left], [right]) =>
    byCodepoint(left, right),
  )) {
    modules[moduleName] = {
      latest: module.version,
      versions: {
        [module.version]: {
          manifest: shadcnIndexFile,
          integrity: module.integrity,
          schemaVersion: module.manifest.schemaVersion,
          provides: module.manifest.provides.map((provided) => provided.capability),
          files: Object.fromEntries(
            [...module.files].map(([path, text]) => [path, computeIntegrity(text)]),
          ),
        },
      },
    };
  }
  return {
    $schema: registryIndexSchemaUrl,
    schemaVersion: supportedRegistrySchemaVersion,
    name: registryName,
    release: shadcnRelease,
    minCliVersion: shadcnMinCliVersion,
    releases: {
      [shadcnRelease]: { path: shadcnIndexFile, integrity: computeIntegrity(indexText) },
    },
    modules,
  };
}

export async function namespaceEnvironment(
  context: OpenRegistryContext,
): Promise<TemplateEnvironment> {
  const env = context.env ?? process.env;
  return context.projectDir === undefined
    ? env
    : await loadNamespaceEnvironment(context.projectDir, env);
}
