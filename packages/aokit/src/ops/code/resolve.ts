import { posix } from "node:path";
import type { Op } from "@aokit/module";
import type { EditBatch } from "../../edit/batch.ts";
import { EditError } from "../../edit/errors.ts";
import { type LocatedAnchor, type ParsedSource, parseSource } from "../../edit/locate.ts";
import type { DeclaredExtensionPoint, OpHandler } from "../../engine/ops.ts";
import { resolveExtensionPoint } from "../extension-point.ts";
import { CodeOpError } from "./errors.ts";

type OpContext = Parameters<OpHandler>[0];

/** The Ops that name an Extension point. */
export type CodeOp = Extract<Op, { extensionPoint: string }>;

const sourceExtensions = /\.(?:ts|tsx|mts|cts)$/;
const declarationFile = /\.d\.(?:ts|mts|cts)$/;
const generatedDirectories = new Set(["node_modules", "dist", "build", "out", ".next", "coverage"]);

/** The declaring file of an Extension point, located and parsed. */
export interface AnchorSite {
  readonly point: DeclaredExtensionPoint;
  readonly path: string;
  readonly source: string;
  readonly parsed: ParsedSource;
  readonly anchor: LocatedAnchor;
}

function requirePoint(context: OpContext, op: CodeOp): DeclaredExtensionPoint {
  const point = resolveExtensionPoint(context, op.extensionPoint, op.range, (code, message) => {
    throw new CodeOpError(`ops.${code}`, message, context.module);
  });
  if (point.target !== op.target) {
    throw new CodeOpError(
      "ops.extension-point-target",
      `Module "${context.module}" targets "${op.target}" but extension point "${op.extensionPoint}" lives on target "${point.target}".`,
      context.module,
    );
  }
  return point;
}

function tryParse(path: string, source: string): ParsedSource | undefined {
  try {
    return parseSource(path, source);
  } catch (error) {
    if (error instanceof EditError && error.code === "edit.parse-failed") {
      return undefined;
    }
    throw error;
  }
}

function underDirectory(path: string, directory: string): boolean {
  return directory === "" || directory === "." || path.startsWith(`${directory}/`);
}

function isHandWrittenSource(path: string): boolean {
  return (
    sourceExtensions.test(path) &&
    !declarationFile.test(path) &&
    !path.split("/").some((segment) => generatedDirectories.has(segment))
  );
}

/** Resolves the Extension point of `op` and locates its anchor in the declaring Target. */
export function locateSite(
  context: OpContext,
  op: CodeOp,
  expectedKinds: readonly string[],
): AnchorSite {
  const point = requirePoint(context, op);
  if (!expectedKinds.includes(point.kind)) {
    throw new CodeOpError(
      "ops.extension-point-kind",
      `Op "${op.op}" of Module "${context.module}" needs an extension point of kind ${expectedKinds.join(" or ")}, but "${point.name}" has kind "${point.kind}".`,
      context.module,
    );
  }
  const directory = posix.dirname(context.resolvePath(point.target, "anchor.ts"));
  const declaredPath =
    point.file === undefined ? undefined : context.resolvePath(point.target, point.file);
  const matches: AnchorSite[] = [];
  for (const path of context.vfs.paths()) {
    const source = context.vfs.read(path);
    if (declaredPath === undefined) {
      if (!underDirectory(path, directory) || !isHandWrittenSource(path)) {
        continue;
      }
    } else if (path !== declaredPath) {
      continue;
    }
    if (typeof source !== "string") {
      continue;
    }
    const parsed = tryParse(path, source);
    const anchor = parsed?.anchors.find((candidate) => candidate.name === point.anchor);
    if (parsed && anchor) {
      matches.push({ point, path, source, parsed, anchor });
    }
  }
  const [site, ...others] = matches;
  if (!site || others.length > 0) {
    const where = matches.length === 0 ? "no file" : matches.map((m) => m.path).join(", ");
    throw new CodeOpError(
      "ops.anchor-file",
      `Extension point "${point.name}" declared by "${point.module}" must resolve to exactly one top-level declaration "${point.anchor}" under "${directory}", found ${where}.`,
      context.module,
    );
  }
  return site;
}

/** The build's shared edit batch of the site's file. */
export function batchOf(context: OpContext, site: AnchorSite): EditBatch {
  return context.edits.batchFor(site.path, context.module);
}

/** Queues edits to the site's file in the shared batch; the session writes it on flush. */
export function commitEdits(
  context: OpContext,
  site: AnchorSite,
  edit: (batch: EditBatch) => void,
): void {
  edit(batchOf(context, site));
}
