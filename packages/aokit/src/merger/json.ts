import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parse,
  parseTree,
  type JSONPath,
  type ParseError,
} from "jsonc-parser";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type JsonOperation =
  | { readonly kind: "set"; readonly path: JSONPath; readonly value: JsonValue }
  | { readonly kind: "remove"; readonly path: JSONPath }
  | { readonly kind: "append"; readonly path: JSONPath; readonly value: JsonValue }
  | { readonly kind: "removeItem"; readonly path: JSONPath; readonly value: JsonValue };

interface Collected {
  readonly operations: JsonOperation[];
  conflict: boolean;
}

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

function isObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return value === undefined ? "undefined" : JSON.stringify(value);
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function collectArray(
  path: JSONPath,
  base: JsonValue[],
  user: JsonValue[],
  next: JsonValue[],
  collected: Collected,
): void {
  const baseKeys = new Set(base.map(canonical));
  const userKeys = new Set(user.map(canonical));
  const nextKeys = new Set(next.map(canonical));
  for (const item of base) {
    const key = canonical(item);
    if (!nextKeys.has(key) && userKeys.has(key)) {
      collected.operations.push({ kind: "removeItem", path, value: item });
    }
  }
  for (const item of next) {
    const key = canonical(item);
    if (!baseKeys.has(key) && !userKeys.has(key)) {
      collected.operations.push({ kind: "append", path, value: item });
    }
  }
}

function collectKey(
  path: JSONPath,
  base: JsonValue | undefined,
  user: JsonValue | undefined,
  next: JsonValue | undefined,
  collected: Collected,
): void {
  if (same(next, base) || same(user, next)) return;
  if (same(user, base)) {
    collected.operations.push(
      next === undefined ? { kind: "remove", path } : { kind: "set", path, value: next },
    );
    return;
  }
  if (isObject(user) && isObject(next) && (base === undefined || isObject(base))) {
    collectObject(path, base ?? {}, user, next, collected);
    return;
  }
  if (Array.isArray(user) && Array.isArray(next) && (base === undefined || Array.isArray(base))) {
    collectArray(path, base ?? [], user, next, collected);
    return;
  }
  collected.conflict = true;
}

function collectObject(
  path: JSONPath,
  base: { [key: string]: JsonValue },
  user: { [key: string]: JsonValue },
  next: { [key: string]: JsonValue },
  collected: Collected,
): void {
  const keys = new Set([...Object.keys(base), ...Object.keys(user), ...Object.keys(next)]);
  for (const key of [...keys].toSorted()) {
    collectKey([...path, key], base[key], user[key], next[key], collected);
  }
}

function insertionIndex(path: JSONPath): (properties: string[]) => number {
  return (properties) => {
    const lastSegment = path[path.length - 1];
    if (typeof lastSegment !== "string") return properties.length;
    return properties.findLastIndex((property) => property < lastSegment) + 1;
  };
}

function arrayAt(text: string, path: JSONPath): unknown[] {
  const tree = parseTree(text, [], { allowTrailingComma: true });
  const node = tree ? findNodeAtLocation(tree, path) : undefined;
  if (node?.type !== "array") return [];
  const items: unknown[] = (node.children ?? []).map((child): unknown => getNodeValue(child));
  return items;
}

function applyOperation(text: string, operation: JsonOperation): string {
  if (operation.kind === "set") {
    return applyEdits(
      text,
      modify(text, operation.path, operation.value, {
        formattingOptions: FORMATTING,
        getInsertionIndex: insertionIndex(operation.path),
      }),
    );
  }
  if (operation.kind === "remove") {
    return applyEdits(
      text,
      modify(text, operation.path, undefined, { formattingOptions: FORMATTING }),
    );
  }
  if (operation.kind === "append") {
    const length = arrayAt(text, operation.path).length;
    return applyEdits(
      text,
      modify(text, [...operation.path, length], operation.value, {
        formattingOptions: FORMATTING,
        isArrayInsertion: true,
      }),
    );
  }
  const target = canonical(operation.value);
  const index = arrayAt(text, operation.path).findIndex((item) => canonical(item) === target);
  if (index === -1) return text;
  return applyEdits(
    text,
    modify(text, [...operation.path, index], undefined, {
      formattingOptions: FORMATTING,
      isArrayInsertion: true,
    }),
  );
}

function parseStrict(text: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  return errors.length > 0 ? undefined : value;
}

/**
 * Structurally merges JSON/JSONC by key into the user's text, preserving its comments and key order.
 * Returns `undefined` when the inputs are not mergeable objects or a scalar changed on both sides.
 */
export function mergeJsonStructurally(
  base: string,
  user: string,
  next: string,
): string | undefined {
  const parsedUser = parseStrict(user);
  const parsedNext = parseStrict(next);
  const parsedBase = base.trim() === "" ? {} : parseStrict(base);
  if (!isObject(parsedUser) || !isObject(parsedNext) || !isObject(parsedBase)) return undefined;
  const collected: Collected = { operations: [], conflict: false };
  collectObject([], parsedBase, parsedUser, parsedNext, collected);
  if (collected.conflict) return undefined;
  return collected.operations.reduce(applyOperation, user);
}
