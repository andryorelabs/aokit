import { Document, isAlias, isMap, isSeq, parseDocument, YAMLMap, type YAMLSeq } from "yaml";

/** A YAML-compatible value. */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

function isPlainObject(value: unknown): value is { [key: string]: YamlValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function mergeSequence(document: Document, sequence: YAMLSeq, incoming: YamlValue[]) {
  const seen = new Set(sequence.toJS(document).map(fingerprint));
  for (const item of incoming) {
    if (seen.has(fingerprint(item))) continue;
    seen.add(fingerprint(item));
    sequence.add(document.createNode(item));
  }
}

function mergeMap(document: Document, map: YAMLMap, incoming: { [key: string]: YamlValue }) {
  for (const [key, value] of Object.entries(incoming)) {
    const existing = map.get(key, true);
    if (isAlias(existing)) {
      const target = existing.resolve(document);
      const resolvedValue: unknown = target?.toJS(document);
      const merged = document.createNode(resolvedValue);
      if (isMap(merged) && isPlainObject(value)) {
        mergeMap(document, merged, value);
      } else if (isSeq(merged) && Array.isArray(value)) {
        mergeSequence(document, merged, value);
      }
      if (fingerprint(merged.toJS(document)) !== fingerprint(resolvedValue)) {
        map.set(key, merged);
      }
      continue;
    }
    if (isMap(existing) && isPlainObject(value)) {
      mergeMap(document, existing, value);
    } else if (isSeq(existing) && Array.isArray(value)) {
      mergeSequence(document, existing, value);
    } else if (!map.has(key)) {
      map.set(key, document.createNode(value));
    } else if (
      !isMap(existing) &&
      !isSeq(existing) &&
      fingerprint(map.get(key)) !== fingerprint(value)
    ) {
      map.set(key, value);
    }
  }
}

/**
 * Merges a patch into YAML text using the Document API, so comments and anchors survive.
 * Maps merge recursively, sequences union by value, and scalars take the patch value.
 */
export function mergeYaml(text: string, patch: { [key: string]: YamlValue }): string {
  const document = text.trim() === "" ? new Document({}) : parseDocument(text);
  if (document.errors.length > 0) {
    throw new Error(`Cannot patch invalid YAML: ${document.errors[0]?.message ?? "unknown error"}`);
  }
  const root = isMap(document.contents) ? document.contents : new YAMLMap();
  document.contents = root;
  mergeMap(document, root, patch);
  return document.toString();
}
