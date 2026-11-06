import type { Op } from "@aokit/module";
import { type Node, findNodeAtLocation, parseTree } from "jsonc-parser";
import type { DeclaredExtensionPoint, OpContext } from "../../engine/ops.ts";
import { resolveExtensionPoint } from "../extension-point.ts";
import { DataOpError } from "./errors.ts";

import type { Target } from "../../engine/layout.ts";

/** The Ops that write a file and may address an Extension point instead of a path. */
export type DataOp = Extract<
  Op,
  { op: "mergeJson" | "mergeYaml" | "addEnv" | "addCssAtRule" | "addCssVariables" | "appendRegion" }
>;

/** Where a data Op writes: the Target, the file relative to it and, for `json` points, the node. */
export interface DataTarget {
  readonly target: Target;
  readonly file: string;
  readonly pointer?: string;
}

const fileMatchers: Readonly<Record<DataOp["op"], RegExp>> = {
  mergeJson: /\.jsonc?$/,
  mergeYaml: /\.ya?ml$/,
  addEnv: /(?:^|\/)\.env[^/]*$/,
  addCssAtRule: /\.css$/,
  addCssVariables: /\.css$/,
  appendRegion: /\.md$/,
};

function describePoint(point: DeclaredExtensionPoint): string {
  return `"${point.name}" (declared by "${point.module}" at version ${point.version})`;
}

/** Decodes a JSON pointer into path segments (RFC 6901). */
export function pointerSegments(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Finds the node a JSON pointer addresses in JSONC text, or `undefined` when it is missing. */
export function nodeAtPointer(text: string, pointer: string): Node | undefined {
  const tree = parseTree(text, [], { allowTrailingComma: true });
  if (!tree) {
    return undefined;
  }
  const segments = pointerSegments(pointer);
  return segments.length === 0 ? tree : findNodeAtLocation(tree, segments);
}

function requirePoint(
  context: OpContext,
  op: Extract<DataOp, { extensionPoint: string }>,
): DeclaredExtensionPoint {
  return resolveExtensionPoint(context, op.extensionPoint, op.range, (code, message) => {
    throw new DataOpError(`ops.${code}`, message, context.module);
  });
}

function declaredFile(context: OpContext, point: DeclaredExtensionPoint, op: DataOp): string {
  const file = point.file;
  if (file === undefined) {
    throw new DataOpError(
      "ops.extension-point-file",
      `Module "${context.module}" cannot resolve extension point ${describePoint(point)}: the declaring Module lists no file for it.\n  fix: declare "file" on the extension point in "${point.module}".`,
      context.module,
    );
  }
  if (!fileMatchers[op.op].test(file)) {
    throw new DataOpError(
      "ops.extension-point-file",
      `Op "${op.op}" of Module "${context.module}" cannot write ${describePoint(point)}: its file "${file}" is not a file type that Op edits.`,
      context.module,
    );
  }
  if (!context.vfs.has(context.resolvePath(point.target, file))) {
    throw new DataOpError(
      "ops.extension-point-file",
      `Module "${context.module}" cannot resolve extension point ${describePoint(point)}: file "${file}" does not exist under target "${point.target}".`,
      context.module,
    );
  }
  return file;
}

/**
 * Resolves where a data Op writes. A path form passes through; an Extension point form resolves
 * the declaring Module's Target and the file it declares for the point and, for `json` points,
 * returns the Anchor as the JSON pointer.
 */
export function resolveDataTarget(context: OpContext, op: DataOp): DataTarget {
  if (!("extensionPoint" in op)) {
    return { target: op.target, file: "file" in op && op.file ? op.file : ".env" };
  }
  const point = requirePoint(context, op);
  const isJson = op.op === "mergeJson";
  if (isJson !== (point.kind === "json")) {
    throw new DataOpError(
      "ops.extension-point-kind",
      `Op "${op.op}" of Module "${context.module}" cannot use extension point ${describePoint(point)} of kind "${point.kind}".\n  fix: ${isJson ? "mergeJson needs a json extension point" : "json extension points are addressed with mergeJson"}.`,
      context.module,
    );
  }
  const pointer = isJson ? point.anchor : undefined;
  const file = declaredFile(context, point, op);
  return pointer === undefined
    ? { target: point.target, file }
    : { target: point.target, file, pointer };
}
