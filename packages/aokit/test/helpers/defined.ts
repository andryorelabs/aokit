/**
 * Returns `value`, or fails the test naming `what` when it is `undefined` or `null`.
 */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${what} to be defined`);
  }
  return value;
}
