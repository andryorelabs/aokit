/**
 * Baseline Oxlint rules that no built-in plugin provides, loaded as a jsPlugin
 * under the `local` alias. The file has no imports so it runs in any Project
 * that has Oxlint, without `@oxlint/plugins` installed.
 */

/**
 * A node or comment with a source range, which a report points at.
 */
interface RangedNode {
  range: [number, number];
}

/**
 * The fields of an Oxlint AST node that these rules read.
 */
interface AstNode extends RangedNode {
  readonly type: string;
  readonly parent?: AstNode | null;
  readonly callee?: AstNode;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly name?: string;
  readonly value?: unknown;
  readonly computed?: boolean;
  readonly body?: AstNode;
  readonly source?: AstNode;
  readonly specifiers?: readonly AstNode[];
  readonly imported?: AstNode;
  readonly local?: AstNode;
}

/**
 * A source comment as Oxlint reports it.
 */
interface SourceComment extends RangedNode {
  readonly type: string;
  readonly value: string;
}

/**
 * The part of the Oxlint rule context these rules use.
 */
interface RuleContext {
  readonly sourceCode: { getAllComments(): SourceComment[] };
  report(descriptor: { node: RangedNode; messageId: string }): void;
}

/**
 * An ESLint-compatible rule definition.
 */
interface BaselineRule {
  readonly meta: {
    readonly type: "problem" | "suggestion";
    readonly docs: { readonly description: string };
    readonly messages: Readonly<Record<string, string>>;
    readonly schema: readonly [];
  };
  create(context: RuleContext): Record<string, (node: unknown) => void>;
}

/**
 * Narrows an Oxlint AST node to the fields these rules read.
 */
function isAstNode(candidate: unknown): candidate is AstNode {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "type" in candidate &&
    "range" in candidate
  );
}

const disableDirectivePattern = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?=\s|$)/;
const directiveReasonPattern = /\s--\s+\S/;

/**
 * Requires a ` -- <reason>` suffix on every `oxlint-disable` or
 * `eslint-disable` directive.
 */
export const requireDescription: BaselineRule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require a ` -- <reason>` suffix on every lint disable directive.",
    },
    messages: {
      missingReason: "Disable directives need a reason: add ` -- <why this is safe>`.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (
            disableDirectivePattern.test(comment.value) &&
            !directiveReasonPattern.test(comment.value)
          ) {
            context.report({ node: comment, messageId: "missingReason" });
          }
        }
      },
    };
  },
};

const asyncMatcherModifiers: ReadonlySet<string> = new Set(["rejects", "resolves"]);

/**
 * The property name of a member access, for both `.name` and `["name"]`.
 */
function memberName(node: AstNode): string | undefined {
  const property = node.property;
  if (node.computed !== true) {
    return property?.type === "Identifier" ? property.name : undefined;
  }
  return typeof property?.value === "string" ? property.value : undefined;
}

/**
 * Whether the member accesses one of `names`.
 */
function isNamedMember(node: AstNode, names: ReadonlySet<string>): boolean {
  const name = memberName(node);
  return name !== undefined && names.has(name);
}

/**
 * Whether the member chain below `node` goes through `expect(...).rejects` or
 * `expect(...).resolves`.
 */
function startsAsyncMatcherChain(node: AstNode | undefined): boolean {
  let current = node;
  while (current?.type === "MemberExpression") {
    if (isNamedMember(current, asyncMatcherModifiers)) {
      const expectCall = current.object;
      return (
        expectCall?.type === "CallExpression" &&
        expectCall.callee?.type === "Identifier" &&
        expectCall.callee.name === "expect"
      );
    }
    current = current.object;
  }
  return false;
}

/**
 * Whether a promise produced at `node` is awaited or handed back to the caller.
 */
function isAwaitedOrReturned(node: AstNode): boolean {
  const parent = node.parent;
  if (parent === undefined || parent === null) {
    return false;
  }
  if (parent.type === "AwaitExpression" || parent.type === "ReturnStatement") {
    return true;
  }
  return parent.type === "ArrowFunctionExpression" && parent.body === node;
}

/**
 * Requires `expect(...).rejects` and `.resolves` assertions to be awaited or
 * returned, so a failing assertion cannot be lost.
 */
export const noUnawaitedAsyncMatcher: BaselineRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require `expect(...).rejects` and `.resolves` assertions to be awaited or returned.",
    },
    messages: {
      unawaited:
        "This async assertion is never awaited, so a failure is silently lost. `await` it or `return` it.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isAstNode(node)) {
          return;
        }
        if (!startsAsyncMatcherChain(node.callee) || isAwaitedOrReturned(node)) {
          return;
        }
        context.report({ node, messageId: "unawaited" });
      },
    };
  },
};

const focusableTestFunctions: ReadonlySet<string> = new Set(["test", "it", "describe"]);
const onlyModifier: ReadonlySet<string> = new Set(["only"]);

/**
 * The name a specifier imports, for both `{ test }` and `{ "test" as run }`.
 */
function importedName(specifier: AstNode): string | undefined {
  const imported = specifier.imported;
  if (imported?.type === "Identifier") {
    return imported.name;
  }
  return typeof imported?.value === "string" ? imported.value : undefined;
}

/**
 * Local bindings for the focusable functions and the namespace imported from
 * `bun:test` in one import declaration.
 */
function collectBunTestBindings(
  declaration: AstNode,
  functionNames: Set<string>,
  namespaceNames: Set<string>,
): void {
  if (declaration.source?.value !== "bun:test") {
    return;
  }
  for (const specifier of declaration.specifiers ?? []) {
    const localName = specifier.local?.name;
    if (localName === undefined) {
      continue;
    }
    if (specifier.type === "ImportNamespaceSpecifier") {
      namespaceNames.add(localName);
      continue;
    }
    const name = importedName(specifier);
    if (specifier.type === "ImportSpecifier" && name !== undefined) {
      if (focusableTestFunctions.has(name)) {
        functionNames.add(localName);
      }
    }
  }
}

/**
 * Whether `node` names a focusable function imported from `bun:test`, either
 * directly (`test`) or through a namespace import (`bun.test`).
 */
function isBunTestFunction(
  node: AstNode | undefined,
  functionNames: ReadonlySet<string>,
  namespaceNames: ReadonlySet<string>,
): boolean {
  if (node?.type === "Identifier") {
    return functionNames.has(node.name ?? "");
  }
  return (
    node?.type === "MemberExpression" &&
    node.object?.type === "Identifier" &&
    namespaceNames.has(node.object.name ?? "") &&
    isNamedMember(node, focusableTestFunctions)
  );
}

/**
 * Rejects `.only` on `test`, `it` and `describe` imported from `bun:test`,
 * which the `jest/no-focused-tests` rule does not see.
 */
export const noBunTestOnly: BaselineRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow `.only` on `test`, `it` and `describe` imported from `bun:test`.",
    },
    messages: {
      focused:
        "A focused test skips every other test in the run. Remove `.only` before committing.",
    },
    schema: [],
  },
  create(context) {
    const functionNames = new Set<string>();
    const namespaceNames = new Set<string>();
    return {
      ImportDeclaration(node) {
        if (isAstNode(node)) {
          collectBunTestBindings(node, functionNames, namespaceNames);
        }
      },
      MemberExpression(node) {
        if (
          isAstNode(node) &&
          isNamedMember(node, onlyModifier) &&
          isBunTestFunction(node.object, functionNames, namespaceNames)
        ) {
          context.report({ node, messageId: "focused" });
        }
      },
    };
  },
};

/**
 * The baseline rules, keyed by the name they have under the `local` alias.
 */
export const baselineLocalRules = {
  "require-description": requireDescription,
  "no-unawaited-async-matcher": noUnawaitedAsyncMatcher,
  "no-bun-test-only": noBunTestOnly,
};

/**
 * The plugin Oxlint loads from `jsPlugins`.
 */
export default {
  meta: { name: "local" },
  rules: baselineLocalRules,
};
