import { posix } from "node:path";

/** Answer values a Module can reference. */
export type AnswerValue = string | number | boolean;

const contentVariable = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const pathVariable = /__([A-Za-z][A-Za-z0-9]*)__/g;

function substitute(
  text: string,
  pattern: RegExp,
  answers: Readonly<Record<string, AnswerValue>>,
): string {
  return text.replace(pattern, (match, name: string) =>
    Object.hasOwn(answers, name) ? String(answers[name]) : match,
  );
}

/**
 * Replaces `{{var}}` in file content from answers. Unknown variables and everything else are
 * left untouched: there are no conditionals, loops or expressions.
 */
export function interpolateContent(
  content: string,
  answers: Readonly<Record<string, AnswerValue>>,
): string {
  return substitute(content, contentVariable, answers);
}

/** Replaces `__name__` in a file or directory path from answers; unknown names stay as they are. */
export function interpolatePath(
  path: string,
  answers: Readonly<Record<string, AnswerValue>>,
): string {
  return substitute(path, pathVariable, answers);
}

const targetVariable = /\{\{target:([a-z][a-z-]*)\}\}/g;

/**
 * Replaces `{{target:name}}` with the directory the Layout resolves the Target to (`.` for the
 * Project root), so a Module can name a Target's location without knowing the Layout.
 */
export function interpolateTargets(text: string, directoryOf: (target: string) => string): string {
  return text.replace(targetVariable, (_match, target: string) => directoryOf(target) || ".");
}

/**
 * Applies {@link interpolateTargets} to every string inside a JSON value. Target directories are
 * plain relative paths, so substituting inside the serialized form keeps the JSON valid.
 */
export function interpolateTargetsDeep<T>(value: T, directoryOf: (target: string) => string): T;
export function interpolateTargetsDeep(
  value: unknown,
  directoryOf: (target: string) => string,
): unknown {
  const interpolated: unknown = JSON.parse(interpolateTargets(JSON.stringify(value), directoryOf));
  return interpolated;
}

const importVariable = /\{\{import:([a-z][a-z-]*):([^}\s]+)\}\}/g;

/**
 * Replaces `{{import:target:subpath}}` with the relative import specifier from the importing
 * file's directory to that Target location, so a Module can import across Targets without knowing
 * the Layout. `resolvePath` maps a Target and subpath to its Project path.
 */
export function interpolateImports(
  text: string,
  fromDirectory: string,
  resolvePath: (target: string, subpath: string) => string,
): string {
  return text.replace(importVariable, (_match, target: string, subpath: string) => {
    const relative = posix.relative(fromDirectory || ".", resolvePath(target, subpath));
    return relative.startsWith(".") ? relative : `./${relative}`;
  });
}
