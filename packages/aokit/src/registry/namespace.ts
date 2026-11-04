import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NamespaceConfig, UserConfig } from "../config/user-config.ts";
import { RegistryError } from "./errors.ts";
import { isReadableRegistryUrl } from "./source.ts";

/** The environment `${VAR}` placeholders expand from. */
type TemplateEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * A Namespace address resolved against the user config. `urlTemplate` is the item URL with
 * `{name}` filled in; it and `headers` still hold their `${VAR}` placeholders, so the target can be
 * logged, returned in `--json` or recorded without exposing a secret.
 */
export interface NamespaceTarget {
  readonly namespace: string;
  readonly item: string;
  readonly urlTemplate: string;
  readonly headers: Record<string, string>;
}

/** A Namespace request with every `${VAR}` expanded: send it, never print or store it. */
export interface ExpandedNamespaceRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** The Namespaces every user has without configuring them; a user config entry replaces one. */
const builtInNamespaces: Readonly<Record<string, NamespaceConfig>> = {
  "@shadcn": { url: "https://ui.shadcn.com/r/{name}.json" },
};

const variablePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const addressPattern = /^(@[a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/;

/** The names of the `${VAR}` placeholders in `value`, in order of first appearance. */
export function templateVariables(value: string): string[] {
  return [...new Set([...value.matchAll(variablePattern)].map((match) => match[1] ?? ""))];
}

function environmentUnset(variable: string): RegistryError {
  return new RegistryError(
    "REGISTRY_ENV_UNSET",
    `The environment variable ${variable} is not set, and a Namespace references it as \${${variable}}.`,
    `Set ${variable} in the environment or in the Project's .env, then run the command again.`,
    { variable },
  );
}

/**
 * Replaces every `${VAR}` in `value` with its value in `env`. An unset variable throws a
 * `REGISTRY_ENV_UNSET` RegistryError naming the variable; the result is never part of the error.
 */
export function expandTemplate(value: string, env: TemplateEnvironment): string {
  for (const variable of templateVariables(value)) {
    if (env[variable] === undefined) {
      throw environmentUnset(variable);
    }
  }
  return value.replaceAll(variablePattern, (_placeholder, variable: string) => env[variable] ?? "");
}

function unknownNamespace(address: string, namespace: string): RegistryError {
  return new RegistryError(
    "REGISTRY_NOT_FOUND",
    `The Namespace ${namespace} of ${address} is not configured.`,
    `Add "${namespace}": { "url": "https://…/r/{name}.json" } under "registries" in the user config, or use @shadcn.`,
    { registry: namespace },
  );
}

function malformedAddress(address: string): RegistryError {
  return new RegistryError(
    "REGISTRY_SOURCE_UNSUPPORTED",
    `"${address}" is not a Namespace address.`,
    "Address a Namespace item as @namespace/item, such as @shadcn/button.",
    { registry: address },
  );
}

/**
 * Resolves `@namespace/item` through the user config `registries`, then the built-in Namespaces.
 * Every `${VAR}` the Namespace references must be set in `env` (else `REGISTRY_ENV_UNSET`), but the
 * returned target keeps the placeholders; expand it with {@link expandNamespaceRequest} at request
 * time.
 */
export function resolveNamespace(
  address: string,
  config: UserConfig,
  env: TemplateEnvironment,
): NamespaceTarget {
  const match = addressPattern.exec(address);
  const namespace = match?.[1];
  const item = match?.[2];
  if (namespace === undefined || item === undefined) {
    throw malformedAddress(address);
  }
  const declared = config.registries?.[namespace] ?? builtInNamespaces[namespace];
  if (declared === undefined) {
    throw unknownNamespace(address, namespace);
  }
  const headers = { ...declared.headers };
  for (const value of [declared.url, ...Object.values(headers)]) {
    expandTemplate(value, env);
  }
  return {
    namespace,
    item,
    urlTemplate: declared.url.replaceAll("{name}", encodeURIComponent(item)),
    headers,
  };
}

/**
 * Expands a target's URL and headers from `env`. The expanded URL must be `https://` (or `http://`
 * on a loopback host); a failure names the placeholder URL, never the expanded one.
 */
export function expandNamespaceRequest(
  target: NamespaceTarget,
  env: TemplateEnvironment,
): ExpandedNamespaceRequest {
  const url = expandTemplate(target.urlTemplate, env);
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined || !isReadableRegistryUrl(parsed)) {
    throw new RegistryError(
      "REGISTRY_SOURCE_UNSUPPORTED",
      `The Namespace ${target.namespace} URL ${target.urlTemplate} is not an https:// URL (or http:// on a loopback host).`,
      `Fix the "url" of ${target.namespace} under "registries" in the user config.`,
      { registry: target.namespace, path: target.urlTemplate },
    );
  }
  const headers = Object.fromEntries(
    Object.entries(target.headers).map(([name, value]) => [name, expandTemplate(value, env)]),
  );
  return { url, headers };
}

const envLinePattern = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(raw: string): string {
  const first = raw.at(0);
  if ((first === '"' || first === "'") && raw.length >= 2 && raw.endsWith(first)) {
    return raw.slice(1, -1);
  }
  const comment = raw.search(/\s#/);
  return (comment === -1 ? raw : raw.slice(0, comment)).trim();
}

/** Parses `KEY=value` lines of a `.env` file; blank lines, `#` comments and `export ` are allowed. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = envLinePattern.exec(line.trim());
    const key = match?.[1];
    const raw = match?.[2];
    if (key !== undefined && raw !== undefined) {
      values[key] = unquote(raw.trim());
    }
  }
  return values;
}

/**
 * The environment Namespace placeholders expand from: the `.env` of `directory` overlaid by `env`,
 * so a variable set in the process environment wins. A missing `.env` is no variables.
 */
export async function loadNamespaceEnvironment(
  directory: string,
  env: TemplateEnvironment,
): Promise<Record<string, string | undefined>> {
  let text: string;
  try {
    text = await readFile(join(directory, ".env"), "utf8");
  } catch (thrown) {
    if (thrown instanceof Error && "code" in thrown && thrown.code === "ENOENT") {
      return { ...env };
    }
    throw thrown;
  }
  const fromFile = parseEnvFile(text);
  const defined = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { ...fromFile, ...defined };
}
