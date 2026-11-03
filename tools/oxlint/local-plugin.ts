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

/**
 * Project-local Oxlint rules, loaded as a jsPlugin under the `local` alias.
 */
export default definePlugin({
  meta: { name: "local" },
  rules: {
    "no-non-doc-comments": noNonDocComments,
  },
});
