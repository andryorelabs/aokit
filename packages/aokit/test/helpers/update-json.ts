/** A parsed JSON value. */
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** A parsed JSON object. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Whether `value` is a non-null, non-array object. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses JSON text into a typed value. */
export function parseJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

/** Parses JSON text that must hold an object. */
export function parseJsonObject(text: string): JsonObject {
  const parsed = parseJson(text);
  if (!isJsonObject(parsed)) throw new Error("expected a JSON object");
  return parsed;
}

/** Walks `path` through nested objects, returning `undefined` when a step is missing. */
export function valueAt(root: unknown, ...path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isJsonObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Walks `path` and requires an object at the end. */
export function objectAt(root: unknown, ...path: string[]): JsonObject {
  const found = valueAt(root, ...path);
  if (!isJsonObject(found)) throw new Error(`expected an object at ${path.join(".")}`);
  return found;
}

/** Walks `path` and requires a string at the end. */
export function stringAt(root: unknown, ...path: string[]): string {
  const found = valueAt(root, ...path);
  if (typeof found !== "string") throw new Error(`expected a string at ${path.join(".")}`);
  return found;
}

/** Walks `path` and requires an array at the end. */
export function arrayAt(root: unknown, ...path: string[]): unknown[] {
  const found = valueAt(root, ...path);
  if (!Array.isArray(found)) throw new Error(`expected an array at ${path.join(".")}`);
  return found as unknown[];
}
