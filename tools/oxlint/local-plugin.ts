import { definePlugin, defineRule } from "@oxlint/plugins";
import type { Comment } from "@oxlint/plugins";

/**
 * Prefixes of comments that tools read. They are exempt from
 * `no-non-doc-comments` because removing them changes tool behavior.
 */
const toolDirectivePrefixes: readonly string[] = [
  "oxlint-disable",
  "oxlint-enable",
  "eslint-disable",
  "eslint-enable",
  "eslint ",
  "global ",
  "globals ",
  "@ts-expect-error",
  "@ts-ignore",
  "@ts-nocheck",
  "@ts-check",
  "istanbul ignore",
  "c8 ignore",
  "v8 ignore",
  "oxfmt-ignore",
  "prettier-ignore",
  "#__PURE__",
  "@__PURE__",
  "#__NO_SIDE_EFFECTS__",
  "@__NO_SIDE_EFFECTS__",
];

const tripleSlashDirectivePattern = /^\/\s*<(reference|amd-module|amd-dependency)\b/;

/**
 * A TSDoc block is a block comment opened with exactly `/**`.
 */
function isDocBlock(comment: Comment): boolean {
  return (
    comment.type === "Block" && comment.value.startsWith("*") && !comment.value.startsWith("**")
  );
}

/**
 * Whether the comment is read by a tool rather than by people.
 */
function isToolDirective(comment: Comment): boolean {
  if (comment.type === "Line" && tripleSlashDirectivePattern.test(comment.value)) {
    return true;
  }
  const directiveText = comment.value.trim();
  return toolDirectivePrefixes.some((prefix) => directiveText.startsWith(prefix));
}

const noNonDocComments = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Allow only TSDoc blocks and tool directive comments.",
    },
    messages: {
      nonDocComment:
        "Only TSDoc blocks on declarations and tool directives are allowed. Rename or extract instead of explaining inline.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang" || isDocBlock(comment) || isToolDirective(comment)) {
            continue;
          }
          context.report({ node: comment, messageId: "nonDocComment" });
        }
      },
    };
  },
});

const disableDirectivePattern = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?=\s|$)/;

const directiveReasonPattern = /\s--\s+\S/;

/**
 * Whether the comment is an `oxlint-disable` or `eslint-disable` directive.
 */
function isDisableDirective(comment: Comment): boolean {
  return disableDirectivePattern.test(comment.value);
}

const requireDescription = defineRule({
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
          if (isDisableDirective(comment) && !directiveReasonPattern.test(comment.value)) {
            context.report({ node: comment, messageId: "missingReason" });
          }
        }
      },
    };
  },
});

const asyncMatcherModifiers: ReadonlySet<string> = new Set(["rejects", "resolves"]);

interface AstNode {
  readonly type: string;
  readonly parent?: AstNode | null;
  readonly callee?: AstNode;
  readonly object?: AstNode;
  readonly property?: AstNode;
  readonly name?: string;
  readonly computed?: boolean;
  readonly body?: AstNode;
}

/**
 * Narrows an Oxlint AST node to the fields this rule reads.
 */
function isAstNode(candidate: unknown): candidate is AstNode {
  return typeof candidate === "object" && candidate !== null && "type" in candidate;
}

/**
 * Whether the member chain below `node` goes through `expect(...).rejects` or
 * `expect(...).resolves`.
 */
function startsAsyncMatcherChain(node: AstNode | undefined): boolean {
  let current = node;
  while (current?.type === "MemberExpression") {
    const isModifier =
      current.computed !== true &&
      current.property?.type === "Identifier" &&
      asyncMatcherModifiers.has(current.property.name ?? "");
    if (isModifier) {
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

const noUnawaitedAsyncMatcher = defineRule({
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
});

/**
 * Project-local Oxlint rules, loaded as a jsPlugin under the `local` alias.
 */
export default definePlugin({
  meta: { name: "local" },
  rules: {
    "no-non-doc-comments": noNonDocComments,
    "require-description": requireDescription,
    "no-unawaited-async-matcher": noUnawaitedAsyncMatcher,
  },
});
