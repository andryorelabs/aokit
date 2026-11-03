import type { Op } from "@aokit/module";
import { type Node, findNodeAtLocation, parseTree } from "jsonc-parser";
import type { DeclaredExtensionPoint, OpContext } from "../../engine/ops.ts";
import { DataOpError } from "./errors.ts";
import { readText } from "./files.ts";

import type { Target } from "../../engine/layout.ts";

/** The Ops that write a file and may address an Extension point instead of a path. */
export type DataOp = Extract<
  Op,
  { op: "mergeJson" | "mergeYaml" | "addEnv" | "addCssAtRule" | "appendRegion" }
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
  const point = context.extensionPoints.get(op.extensionPoint);
  if (!point) {
    throw new DataOpError(
      "ops.extension-point-missing",
      `Module "${context.module}" uses extension point "${op.extensionPoint}@${op.range}" but no selected Module declares it.\n  fix: select the Module that declares "${op.extensionPoint}".`,
      context.module,
    );
  }
  if (!Bun.semver.satisfies(point.version, op.range)) {
    throw new DataOpError(
      "ops.extension-point-range",
      `Module "${context.module}" requires extension point "${op.extensionPoint}@${op.range}" but "${point.module}" provides ${point.version}.\n  fix: use a ${context.module} release that supports ${op.extensionPoint}@${point.version}, or update ${point.module}.`,
      context.module,
    );
  }
  return point;
}

function underDirectory(path: string, directory: string): boolean {
  return directory === "" || directory === "." || path.startsWith(`${directory}/`);
}

function relativeTo(path: string, directory: string): string {
  return directory === "" || directory === "." ? path : path.slice(directory.length + 1);
}

function candidateFiles(
  context: OpContext,
  point: DeclaredExtensionPoint,
  op: DataOp,
  pointer: string | undefined,
): string[] {
  const directory = context.resolvePath(point.target, "");
  return context.vfs
    .paths()
    .filter((path) => underDirectory(path, directory) && fileMatchers[op.op].test(path))
    .filter(
      (path) =>
        pointer === undefined || nodeAtPointer(readText(context.vfs, path), pointer) !== undefined,
    );
}

/**
 * Resolves where a data Op writes. A path form passes through; an Extension point form resolves
 * the declaring Module's Target, finds the single file that holds the point and, for `json`
 * points, returns the Anchor as the JSON pointer.
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
  const files = candidateFiles(context, point, op, pointer);
  const [file, ...others] = files;
  if (file === undefined || others.length > 0) {
    const code =
      isJson && files.length === 0 ? "ops.json-pointer-missing" : "ops.extension-point-file";
    const found = files.length === 0 ? "no file" : files.join(", ");
    throw new DataOpError(
      code,
      `Module "${context.module}" cannot resolve extension point ${describePoint(point)}: expected exactly one file${pointer === undefined ? "" : ` with a node at "${pointer}"`} under target "${point.target}", found ${found}.`,
      context.module,
    );
  }
  const relative = relativeTo(file, context.resolvePath(point.target, ""));
  return pointer === undefined
    ? { target: point.target, file: relative }
    : { target: point.target, file: relative, pointer };
}
