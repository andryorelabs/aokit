/** Answer values a Module can reference. */
export type AnswerValue = string | number | boolean;

const contentVariable = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const pathVariable = /__([A-Za-z][A-Za-z0-9]*)__/g;

function substitute(
  text: string,
  pattern: RegExp,
  answers: Readonly<Record<string, AnswerValue>>,
): string {
  return text.replace(pattern, (match, name: string) =>
    Object.hasOwn(answers, name) ? String(answers[name]) : match,
  );
}

/**
 * Replaces `{{var}}` in file content from answers. Unknown variables and everything else are
 * left untouched: there are no conditionals, loops or expressions.
 */
export function interpolateContent(
  content: string,
  answers: Readonly<Record<string, AnswerValue>>,
): string {
  return substitute(content, contentVariable, answers);
}

/** Replaces `__name__` in a file or directory path from answers; unknown names stay as they are. */
export function interpolatePath(
  path: string,
  answers: Readonly<Record<string, AnswerValue>>,
): string {
  return substitute(path, pathVariable, answers);
}
