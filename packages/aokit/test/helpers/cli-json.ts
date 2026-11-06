import { z } from "zod";

/**
 * Parses JSON text into an `unknown` value so callers must narrow before use.
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text);
}

/**
 * Walks `path` through nested objects and arrays, returning `undefined` when a step is missing.
 */
export function jsonAt(value: unknown, ...path: ReadonlyArray<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = new Map<string, unknown>(Object.entries(current)).get(String(key));
  }
  return current;
}

/**
 * Parses JSON text and reads the value at `path` in one step.
 */
export function parseJsonAt(text: string, ...path: ReadonlyArray<string | number>): unknown {
  return jsonAt(parseJson(text), ...path);
}

const commandIndexSchema = z.object({ commands: z.array(z.object({ name: z.string() })) });

/**
 * Parses the `aokit schema` index output into its command names.
 */
export function commandNamesFrom(text: string): string[] {
  return commandIndexSchema.parse(parseJson(text)).commands.map((command) => command.name);
}

/**
 * Lists the own keys of the object at `path`, or an empty list when it is not an object.
 */
export function keysAt(value: unknown, ...path: ReadonlyArray<string | number>): string[] {
  const target = jsonAt(value, ...path);
  return typeof target === "object" && target !== null ? Object.keys(target) : [];
}
