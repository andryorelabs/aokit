import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  type ModuleManifest,
  type ModuleManifestInput,
  ManifestError,
  parseManifest,
  stableStringify,
} from "@aokit/module";
import { RegistryError } from "../errors.ts";
import { computeModuleIntegrity, type Integrity } from "../integrity.ts";
import type { ShadcnItem } from "./schema.ts";

/**
 * A shadcn item presented as a Module: a declarative synthetic manifest plus the embedded file
 * contents it references, a synthetic version and the integrity over both.
 */
export interface AdaptedModule {
  manifest: ModuleManifest;
  files: ReadonlyMap<string, string>;
  version: string;
  integrity: Integrity;
}

/**
 * What the adapter needs to know about where an item came from.
 */
export interface AdaptContext {
  /** The Namespace or Lockfile Registry key, with or without a leading `@`. */
  scope: string;
  /** The full commit SHA for git sources; absent for URL Registries. */
  sourceSha?: string;
}

type Target = "root" | "web" | "shared-ui";

interface Destination {
  target: Target;
  to: string;
}

interface Placement {
  target: Target;
  directory: string;
}

type OpList = NonNullable<ModuleManifestInput["ops"]>;

const stylesheet = { target: "web", file: "src/styles.css" } as const;

const placements: Readonly<Record<string, Placement>> = {
  ui: { target: "shared-ui", directory: "ui" },
  component: { target: "shared-ui", directory: "components" },
  hook: { target: "shared-ui", directory: "hooks" },
  lib: { target: "shared-ui", directory: "lib" },
  block: { target: "web", directory: "" },
  page: { target: "web", directory: "" },
  file: { target: "root", directory: "" },
  item: { target: "root", directory: "" },
  theme: { target: "root", directory: "" },
  style: { target: "root", directory: "" },
};

const deferredTypes = new Set(["base", "font"]);
const seededTypes = new Set(["page", "file"]);
const stylingTypes = new Set(["theme", "style"]);

const aliasPattern = /^@(components|ui|lib|hooks)\/(.*)$/;
const unknownPlaceholderPattern = /^(@[^/\s]+)\//;
const importSpecifierPattern =
  /(\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'])((?:@(?:components|ui|lib|hooks)|~)\/[^"'\n]*)\2/g;

function unsupported(item: ShadcnItem, message: string, fix: string): RegistryError {
  return new RegistryError("REGISTRY_ITEM_UNSUPPORTED", message, fix, { module: item.name });
}

function unsafePath(item: ShadcnItem, path: string): RegistryError {
  return new RegistryError(
    "REGISTRY_PATH_UNSAFE",
    `shadcn item "${item.name}" has a file path "${path}" that escapes its Target`,
    "Use a relative path inside the Target, without '..' segments or a leading '/'.",
    { module: item.name, path },
  );
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function itemType(item: ShadcnItem): string {
  const type = item.type.startsWith("registry:") ? item.type.slice("registry:".length) : item.type;
  if (deferredTypes.has(type)) {
    throw unsupported(
      item,
      `shadcn item "${item.name}" has type "${item.type}", which aokit does not support yet`,
      "Install the item with the shadcn CLI, or remove it from the dependency list.",
    );
  }
  if (!Object.hasOwn(placements, type)) {
    throw unsupported(
      item,
      `shadcn item "${item.name}" has unknown type "${item.type}"`,
      "Use one of: ui, component, block, page, hook, lib, file, theme, style, item.",
    );
  }
  return type;
}

function cleanRelativePath(item: ShadcnItem, path: string): string {
  const stripped = path.startsWith("./") ? path.slice(2) : path;
  const segments = stripped.split("/");
  const escapes =
    stripped.startsWith("/") ||
    stripped.includes("\\") ||
    /^[A-Za-z]:/.test(stripped) ||
    segments.some((segment) => segment === ".." || segment === "" || segment === ".");
  if (escapes) throw unsafePath(item, path);
  return stripped;
}

function resolvePlaceholder(item: ShadcnItem, path: string): Destination | undefined {
  if (path.startsWith("~/")) {
    return { target: "root", to: cleanRelativePath(item, path.slice(2)) };
  }
  const alias = aliasPattern.exec(path);
  if (alias !== null) {
    const subpath = cleanRelativePath(item, alias[2] ?? "");
    return { target: "shared-ui", to: `${alias[1]}/${subpath}` };
  }
  const unknown = unknownPlaceholderPattern.exec(path);
  if (unknown !== null) {
    throw unsupported(
      item,
      `shadcn item "${item.name}" uses the unknown placeholder "${unknown[1]}/" in "${path}"`,
      "Use one of the supported placeholders: @components/, @ui/, @lib/, @hooks/, ~/.",
    );
  }
  return undefined;
}

function resolveDestination(
  item: ShadcnItem,
  type: string,
  file: ShadcnItem["files"][number],
): Destination {
  const placement = placements[type] ?? { target: "root", directory: "" };
  if (file.target !== undefined) {
    const placed = resolvePlaceholder(item, file.target);
    if (placed !== undefined) return placed;
    return { target: placement.target, to: cleanRelativePath(item, file.target) };
  }
  const placedPath = resolvePlaceholder(item, file.path);
  if (placedPath !== undefined) return placedPath;
  const name = posix.basename(cleanRelativePath(item, file.path));
  return {
    target: placement.target,
    to: placement.directory === "" ? name : `${placement.directory}/${name}`,
  };
}

function rewriteImports(item: ShadcnItem, own: Destination, content: string): string {
  return content.replaceAll(
    importSpecifierPattern,
    (_match, prefix: string, quote: string, specifier: string) => {
      const destination = resolvePlaceholder(item, specifier);
      if (destination === undefined) return `${prefix}${quote}${specifier}${quote}`;
      if (destination.target !== own.target) {
        throw unsupported(
          item,
          `shadcn item "${item.name}" file "${own.to}" imports "${specifier}" across Targets (${own.target} to ${destination.target}), which has no Layout-independent specifier`,
          "Ship the imported file in the same Target as the importer.",
        );
      }
      const relative = posix.relative(posix.dirname(own.to), destination.to);
      const local = relative.startsWith(".") ? relative : `./${relative}`;
      return `${prefix}${quote}${local}${quote}`;
    },
  );
}

function parseDependency(spec: string): { name: string; range: string } {
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), range: spec.slice(at + 1) || "*" };
  return { name: spec, range: "*" };
}

function dependencyMap(specs: readonly string[]): Record<string, { range: string }> | undefined {
  if (specs.length === 0) return undefined;
  const entries = specs.map((spec) => {
    const { name, range } = parseDependency(spec);
    return [name, { range }] as const;
  });
  return Object.fromEntries(entries);
}

function cssBody(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const lines = Object.entries(value).map(([key, entry]) =>
    typeof entry === "string" ? `${key}: ${entry};` : `${key} { ${cssBody(entry) ?? ""} }`,
  );
  return lines.length === 0 ? undefined : lines.join(" ");
}

function cssOps(item: ShadcnItem): OpList {
  const ops: OpList = [];
  for (const [key, value] of Object.entries(item.css ?? {})) {
    const match = /^@(import|plugin|theme)\b\s*(.*)$/s.exec(key.trim());
    if (match === null) {
      throw unsupported(
        item,
        `shadcn item "${item.name}" has the css rule "${key}", which aokit cannot apply declaratively`,
        "Only @import, @plugin and @theme rules are supported.",
      );
    }
    const rule = match[1] === "import" || match[1] === "plugin" ? match[1] : "theme";
    const body = cssBody(value);
    ops.push({
      op: "addCssAtRule",
      ...stylesheet,
      rule,
      params: match[2] ?? "",
      ...(body === undefined ? {} : { body }),
    });
  }
  return ops;
}

function cssVariableOps(item: ShadcnItem): OpList {
  const ops: OpList = [];
  for (const group of ["theme", "light", "dark"] as const) {
    const entries = Object.entries(item.cssVars?.[group] ?? {});
    if (entries.length === 0) continue;
    const variables = Object.fromEntries(
      entries.map(([key, value]) => [key.startsWith("--") ? key : `--${key}`, value]),
    );
    ops.push({ op: "addCssVariables", ...stylesheet, group, variables });
  }
  return ops;
}

function versionOf(item: ShadcnItem, sourceSha: string | undefined): string {
  const basis =
    sourceSha !== undefined && /^[0-9a-f]{40}$/.test(sourceSha)
      ? sourceSha
      : sha256Hex(sourceSha ?? stableStringify(item));
  return `0.0.0-shadcn.${basis.slice(0, 12)}`;
}

/**
 * Presents a shadcn registry item as an Adapted Module. The result is declarative: files, deps,
 * env and Ops only, never a transform, script or migration. Pure: no disk and no network.
 *
 * @throws RegistryError `REGISTRY_ITEM_UNSUPPORTED` for `base`, `font`, unknown types, unknown
 * placeholders and constructs that cannot be applied declaratively; `REGISTRY_PATH_UNSAFE` for a
 * file path that escapes its Target.
 */
export function adaptShadcnItem(item: ShadcnItem, context: AdaptContext): AdaptedModule {
  const type = itemType(item);
  const ownership = seededTypes.has(type) ? "seed" : "managed";
  const files = new Map<string, string>();
  const fileEntries: NonNullable<ModuleManifestInput["files"]> = [];
  for (const file of item.files) {
    const destination = resolveDestination(item, type, file);
    const from = `files/${destination.target}/${destination.to}`;
    if (files.has(from)) {
      throw unsafePath(item, `${destination.target}/${destination.to} (duplicate destination)`);
    }
    files.set(from, rewriteImports(item, destination, file.content));
    fileEntries.push({ from, to: destination.to, target: destination.target, ownership });
  }
  const variableOps = cssVariableOps(item);
  const atRuleOps = cssOps(item);
  const needsStyling = variableOps.length > 0 || atRuleOps.length > 0 || stylingTypes.has(type);
  const dependencies = dependencyMap(item.dependencies);
  const devDependencies = dependencyMap(item.devDependencies);
  const version = versionOf(item, context.sourceSha);
  const scope = context.scope.startsWith("@") ? context.scope.slice(1) : context.scope;
  const input: ModuleManifestInput = {
    name: `@${scope}/${item.name}`,
    version,
    requires: needsStyling ? ["styling"] : [],
    files: fileEntries,
    ...(dependencies === undefined && devDependencies === undefined
      ? {}
      : {
          deps: {
            ...(dependencies === undefined ? {} : { dependencies }),
            ...(devDependencies === undefined ? {} : { devDependencies }),
          },
        }),
    env: Object.entries(item.envVars ?? {}).map(([key, example]) => ({
      key,
      scope: "web",
      example,
    })),
    ops: [...variableOps, ...atRuleOps],
  };
  let manifest: ModuleManifest;
  try {
    manifest = parseManifest(input);
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error;
    throw new RegistryError(
      "REGISTRY_MANIFEST_INVALID",
      `shadcn item "${item.name}" cannot be adapted: ${error.message}`,
      "Report the item to its Registry maintainer.",
      { module: item.name },
    );
  }
  return {
    manifest,
    files,
    version,
    integrity: computeModuleIntegrity(stableStringify(manifest), files),
  };
}
