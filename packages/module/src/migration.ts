/**
 * Read and write access a Migration has to the Project, over Target-resolved paths relative to the
 * Project root. `read` returns `undefined` for a missing file; `list` returns the paths below a
 * prefix in codepoint order.
 */
export interface MigrationVfs {
  read(path: string): string | undefined;
  write(path: string, content: string): void;
  delete(path: string): void;
  list(prefix?: string): string[];
}

/**
 * The deterministic context a Migration runs with: the injected clock and random source, never
 * `Date.now()` or `Math.random()`.
 */
export interface MigrationContext {
  now: Date;
  random: () => number;
}

/**
 * What the runner hands a Migration script.
 */
export interface MigrationInput {
  vfs: MigrationVfs;
  answers: Readonly<Record<string, unknown>>;
  context: MigrationContext;
}

/**
 * A Migration script: edits the VFS and may return migrated answers (`before` stage).
 */
export type MigrationFn = (input: MigrationInput) => Record<string, unknown> | void;

/**
 * Typed identity function: type-checks a Migration script and returns it unchanged.
 */
export function defineMigration(fn: MigrationFn): MigrationFn {
  return fn;
}
