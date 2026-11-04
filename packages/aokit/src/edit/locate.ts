import { parseSync } from "oxc-parser";
import type { Node, ParseResult } from "oxc-parser";
import { EditError } from "./errors.ts";

/** A half-open `[start, end)` range of UTF-16 offsets into the original source. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/** Parses one source; the native oxc-parser satisfies it. */
export type ParseSource = (fileName: string, sourceText: string) => ParseResult;

type AnchorValueKind = "array" | "object" | "other";

/** The value a top-level declaration is initialised with. */
interface AnchorValue extends Span {
  readonly kind: AnchorValueKind;
  /** Spans of array elements or object properties, in source order. */
  readonly entries: readonly Span[];
}

/** A top-level declaration located by name (ADR 0014). */
export interface LocatedAnchor {
  readonly name: string;
  readonly declaration: Span;
  readonly value: AnchorValue | undefined;
}

/** An import statement of the file. */
interface LocatedImport {
  readonly source: string;
  readonly span: Span;
}

/** A source parsed once, queried by anchor name or import. */
export interface ParsedSource {
  readonly fileName: string;
  readonly anchors: readonly LocatedAnchor[];
  readonly imports: readonly LocatedImport[];
}

/** Parses with the native oxc-parser build. */
const parseNative: ParseSource = (fileName, sourceText) =>
  parseSync(fileName, sourceText, { lang: "ts" });

function spanOf(node: Span): Span {
  return { start: node.start, end: node.end };
}

function unwrapExpression(expression: Node): Node {
  let current = expression;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSTypeAssertion"
  ) {
    current = current.expression;
  }
  return current;
}

function describeValue(expression: Node | null | undefined): AnchorValue | undefined {
  if (!expression) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.type === "ArrayExpression") {
    const entries = unwrapped.elements.flatMap((element) => (element ? [spanOf(element)] : []));
    return { ...spanOf(unwrapped), kind: "array", entries };
  }
  if (unwrapped.type === "ObjectExpression") {
    return {
      ...spanOf(unwrapped),
      kind: "object",
      entries: unwrapped.properties.map((property) => spanOf(property)),
    };
  }
  return { ...spanOf(unwrapped), kind: "other", entries: [] };
}

function declarationsOf(statement: Node): LocatedAnchor[] {
  const declaration =
    statement.type === "ExportNamedDeclaration" && statement.declaration
      ? statement.declaration
      : statement;
  const declarationSpan = spanOf(statement);
  if (declaration.type === "VariableDeclaration") {
    return declaration.declarations.flatMap((declarator) =>
      declarator.id.type === "Identifier"
        ? [
            {
              name: declarator.id.name,
              declaration: declarationSpan,
              value: describeValue(declarator.init),
            },
          ]
        : [],
    );
  }
  if (
    (declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration" ||
      declaration.type === "TSEnumDeclaration") &&
    declaration.id
  ) {
    return [{ name: declaration.id.name, declaration: declarationSpan, value: undefined }];
  }
  return [];
}

/** Parses `sourceText` and records every top-level declaration and import. */
export function parseSource(
  fileName: string,
  sourceText: string,
  parse: ParseSource = parseNative,
): ParsedSource {
  const result = parse(fileName, sourceText);
  const fatal = result.errors.find((diagnostic) => diagnostic.severity.toString() === "Error");
  if (fatal) {
    throw new EditError(
      "edit.parse-failed",
      `Cannot parse ${fileName}: ${fatal.message}`,
      fileName,
    );
  }
  const body = result.program.body;
  const anchors = body.flatMap((statement) => declarationsOf(statement));
  const imports = body.flatMap((statement) =>
    statement.type === "ImportDeclaration"
      ? [{ source: statement.source.value, span: spanOf(statement) }]
      : [],
  );
  return { fileName, anchors, imports };
}

/** Finds a top-level declaration by name or fails naming the anchor and the file. */
export function locateAnchor(parsed: ParsedSource, anchorName: string): LocatedAnchor {
  const found = parsed.anchors.find((anchor) => anchor.name === anchorName);
  if (!found) {
    throw new EditError(
      "edit.anchor-not-found",
      `Anchor "${anchorName}" not found in ${parsed.fileName}. Anchors are top-level declaration names (ADR 0014).`,
      parsed.fileName,
    );
  }
  return found;
}
