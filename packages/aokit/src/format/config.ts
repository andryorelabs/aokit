import { matchesGlob, posix } from "node:path";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import type { FormatConfig, Oxfmtrc } from "oxfmt";
import type { Vfs } from "../engine/index.ts";
import { FormatError } from "./errors.ts";

const configNames = [".oxfmtrc.json", ".oxfmtrc.jsonc"] as const;

/** A parsed `.oxfmtrc.json` and the directory its patterns are rooted at. */
export interface ProjectFormatConfig {
  readonly path: string;
  readonly directory: string;
  readonly config: Oxfmtrc;
}

function isOxfmtrc(value: unknown): value is Oxfmtrc {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfig(path: string, text: string): Oxfmtrc {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  const firstError = errors[0];
  if (firstError !== undefined) {
    throw new FormatError(
      "format.invalid-config",
      `Invalid Oxfmt config "${path}": ${printParseErrorCode(firstError.error)} at offset ${firstError.offset}.`,
      `Fix the JSON in "${path}" or remove the file to use Oxfmt defaults.`,
    );
  }
  if (!isOxfmtrc(value)) {
    throw new FormatError(
      "format.invalid-config",
      `Invalid Oxfmt config "${path}": expected a JSON object.`,
      `Make "${path}" a JSON object of Oxfmt options.`,
    );
  }
  return value;
}

/** Every Oxfmt config in the VFS, deepest directory first. */
export function readProjectConfigs(vfs: Vfs): readonly ProjectFormatConfig[] {
  const configs: ProjectFormatConfig[] = [];
  for (const path of vfs.paths()) {
    if (!(configNames as readonly string[]).includes(posix.basename(path))) {
      continue;
    }
    const content = vfs.read(path);
    if (typeof content !== "string") {
      continue;
    }
    const directory = posix.dirname(path);
    if (configs.some((existing) => existing.directory === directory)) {
      continue;
    }
    configs.push({ path, directory, config: parseConfig(path, content) });
  }
  return configs.toSorted((a, b) => b.directory.length - a.directory.length);
}

function relativeTo(directory: string, path: string): string | undefined {
  if (directory === ".") {
    return path;
  }
  return path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : undefined;
}

/** Gitignore-style match: slash-free patterns match at any depth, and a directory covers its files. */
function matchesPattern(path: string, rawPattern: string): boolean {
  const pattern = rawPattern.replace(/^\//, "").replace(/\/$/, "");
  if (pattern === "") {
    return false;
  }
  const anchored = rawPattern.startsWith("/") || pattern.includes("/");
  const candidates = anchored ? [pattern] : [pattern, `**/${pattern}`];
  return candidates.some(
    (candidate) => matchesGlob(path, candidate) || matchesGlob(path, `${candidate}/**`),
  );
}

function matchesAny(path: string, patterns: readonly string[] | undefined): boolean {
  return (patterns ?? []).some((pattern) => matchesPattern(path, pattern));
}

/** Gitignore ordering: patterns apply in order, the last match wins, and `!` re-includes. */
export function matchesIgnore(path: string, patterns: readonly string[]): boolean {
  let ignored = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    if (negated !== ignored) {
      continue;
    }
    if (matchesPattern(path, negated ? pattern.slice(1) : pattern)) {
      ignored = !negated;
    }
  }
  return ignored;
}

/**
 * The options for one file from its nearest config, or `undefined` when the config ignores it.
 * `ignorePatterns` and `overrides` resolve here because Oxfmt's `format` API takes plain options.
 */
export function optionsFor(
  path: string,
  configs: readonly ProjectFormatConfig[],
): FormatConfig | undefined {
  for (const { directory, config } of configs) {
    const relative = relativeTo(directory, path);
    if (relative === undefined) {
      continue;
    }
    if (matchesIgnore(relative, config.ignorePatterns ?? [])) {
      return undefined;
    }
    const { $schema: _schema, ignorePatterns: _ignore, overrides, ...base } = config;
    const options: FormatConfig = { ...base };
    for (const override of overrides ?? []) {
      if (matchesAny(relative, override.files) && !matchesAny(relative, override.excludeFiles)) {
        Object.assign(options, override.options);
      }
    }
    return options;
  }
  return {};
}
