import { applyEdits, modify, parse, type JSONPath } from "jsonc-parser";

/** A JSON-compatible value. */
export type JsoncValue =
  | string
  | number
  | boolean
  | null
  | JsoncValue[]
  | { [key: string]: JsoncValue };

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

function isPlainObject(value: unknown): value is { [key: string]: JsoncValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsoncArray(value: unknown): value is JsoncValue[] {
  return Array.isArray(value);
}

function sortedEntries(value: { [key: string]: JsoncValue }): [string, JsoncValue][] {
  return Object.entries(value).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function sortKeysDeep(value: JsoncValue): JsoncValue {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isPlainObject(value)) return value;
  const sorted: { [key: string]: JsoncValue } = {};
  for (const [key, child] of sortedEntries(value)) {
    sorted[key] = sortKeysDeep(child);
  }
  return sorted;
}

function unionByValue(existing: JsoncValue[], incoming: JsoncValue[]): JsoncValue[] {
  const seen = new Set(existing.map((item) => JSON.stringify(sortKeysDeep(item))));
  const merged = [...existing];
  for (const item of incoming) {
    const fingerprint = JSON.stringify(sortKeysDeep(item));
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    merged.push(item);
  }
  return merged;
}

function setAt(text: string, path: JSONPath, value: JsoncValue): string {
  const edits = modify(text, path, value, {
    formattingOptions: FORMATTING,
    getInsertionIndex: (properties) => {
      const lastSegment = path[path.length - 1];
      if (typeof lastSegment !== "string") return properties.length;
      return properties.filter((property) => property < lastSegment).length;
    },
  });
  return applyEdits(text, edits);
}

function mergeAt(text: string, path: JSONPath, current: unknown, patch: JsoncValue): string {
  if (isPlainObject(patch) && isPlainObject(current)) {
    let next = text;
    for (const [key, child] of sortedEntries(patch)) {
      next = mergeAt(next, [...path, key], current[key], child);
    }
    return next;
  }
  if (Array.isArray(patch) && isJsoncArray(current)) {
    const merged = unionByValue(current, patch);
    let next = text;
    for (let index = current.length; index < merged.length; index += 1) {
      const edits = modify(next, [...path, index], merged[index], {
        formattingOptions: FORMATTING,
        isArrayInsertion: true,
      });
      next = applyEdits(next, edits);
    }
    return next;
  }
  if (JSON.stringify(current) === JSON.stringify(patch)) return text;
  return setAt(text, path, sortKeysDeep(patch));
}

/**
 * Merges a patch into JSONC text, preserving comments and formatting.
 * Objects merge recursively, arrays union by value, scalars take the patch value,
 * and new keys are inserted at their sorted position.
 */
export function mergeJsonc(text: string, patch: { [key: string]: JsoncValue }): string {
  const base = text.trim() === "" ? "{}\n" : text;
  const current: unknown = parse(base, [], { allowTrailingComma: true });
  return mergeAt(base, [], isPlainObject(current) ? current : {}, patch);
}
