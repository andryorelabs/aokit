import { type Node } from "jsonc-parser";
import { EngineError } from "../../engine/errors.ts";
import type { OpHandler, OpHandlers } from "../../engine/ops.ts";
import { addEnv } from "../../patchers/env/index.ts";
import { type JsoncValue, mergeJsonc } from "../../patchers/jsonc/index.ts";
import { appendRegion } from "../../patchers/markdown/index.ts";
import { addCssAtRule } from "../../patchers/postcss/index.ts";
import { mergeYaml } from "../../patchers/yaml/index.ts";
import { DataOpError } from "./errors.ts";
import { readText, writeIfChanged } from "./files.ts";
import { type DataOp, nodeAtPointer, pointerSegments, resolveDataTarget } from "./target.ts";

export { applyDeps } from "./deps.ts";
export { applyEnv } from "./env.ts";

type OpContext = Parameters<OpHandler>[0];

function editFile(
  context: OpContext,
  op: DataOp,
  edit: (text: string, pointer: string | undefined) => string,
): void {
  const { target, file, pointer } = resolveDataTarget(context, op);
  const path = context.resolvePath(target, file);
  writeIfChanged(context.vfs, path, edit(readText(context.vfs, path), pointer));
}

function describeNodeType(node: Node): string {
  return node.type === "array" ? "an array" : node.type === "object" ? "an object" : "a scalar";
}

function mergeAtPointer(
  context: OpContext,
  op: Extract<DataOp, { op: "mergeJson" }>,
  text: string,
  pointer: string,
): string {
  const point = context.extensionPoints.get("extensionPoint" in op ? op.extensionPoint : "");
  const where = `extension point "${point?.name}" declared by "${point?.module}" at version ${point?.version} (pointer "${pointer}")`;
  const node = nodeAtPointer(text, pointer);
  if (!node) {
    throw new DataOpError(
      "ops.json-pointer-missing",
      `Module "${context.module}" cannot merge into ${where}: no node at that pointer.`,
      context.module,
    );
  }
  const value = op.value;
  const valueIsArray = Array.isArray(value);
  const valueIsObject = typeof value === "object" && value !== null && !valueIsArray;
  if ((valueIsArray && node.type !== "array") || (valueIsObject && node.type !== "object")) {
    throw new DataOpError(
      "ops.json-pointer-type",
      `Module "${context.module}" cannot merge ${valueIsArray ? "an array" : "an object"} into ${where}: the node is ${describeNodeType(node)}.`,
      context.module,
    );
  }
  const segments = pointerSegments(pointer);
  if (segments.length === 0) {
    return mergeJsonc(text, toObject(context, value, where));
  }
  const patch = segments.toReversed().reduce<JsoncValue>((inner, key) => ({ [key]: inner }), value);
  return mergeJsonc(text, toObject(context, patch, where));
}

function toObject(
  context: OpContext,
  value: unknown,
  where: string,
): { [key: string]: JsoncValue } {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
  throw new DataOpError(
    "ops.json-pointer-type",
    `Module "${context.module}" cannot merge a non-object value at the root of ${where}.`,
    context.module,
  );
}

function mismatch(context: OpContext, expected: string, received: string): never {
  throw new EngineError(
    "engine.unknown-op",
    `Handler for "${expected}" received "${received}" in Module "${context.module}".`,
    [context.module],
  );
}

function parseDeclarations(body: string | undefined): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of (body ?? "").split(/[;\n]/)) {
    const separator = part.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const property = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (property !== "" && value !== "") {
      declarations[property] = value;
    }
  }
  return declarations;
}

/** Handlers for the data Ops (`mergeJson`, `mergeYaml`, `addEnv`, `addCssAtRule`, `appendRegion`). */
export const dataOpHandlers: OpHandlers = {
  mergeJson(context, op) {
    if (op.op !== "mergeJson") {
      mismatch(context, "mergeJson", op.op);
    }
    editFile(context, op, (text, pointer) =>
      pointer === undefined
        ? mergeJsonc(text, toObject(context, op.value, "the file"))
        : mergeAtPointer(context, op, text, pointer),
    );
  },
  mergeYaml(context, op) {
    if (op.op !== "mergeYaml") {
      mismatch(context, "mergeYaml", op.op);
    }
    editFile(context, op, (text) => mergeYaml(text, op.value));
  },
  addEnv(context, op) {
    if (op.op !== "addEnv") {
      mismatch(context, "addEnv", op.op);
    }
    editFile(context, op, (text) => addEnv(text, op.entries));
  },
  addCssAtRule(context, op) {
    if (op.op !== "addCssAtRule") {
      mismatch(context, "addCssAtRule", op.op);
    }
    const declarations = parseDeclarations(op.body);
    editFile(context, op, (text) =>
      addCssAtRule(text, {
        name: op.rule,
        params: op.params,
        ...(Object.keys(declarations).length > 0 ? { declarations } : {}),
      }),
    );
  },
  appendRegion(context, op) {
    if (op.op !== "appendRegion") {
      mismatch(context, "appendRegion", op.op);
    }
    editFile(context, op, (text) =>
      appendRegion(text, { module: `${context.module}:${op.region}`, content: op.content }),
    );
  },
};
