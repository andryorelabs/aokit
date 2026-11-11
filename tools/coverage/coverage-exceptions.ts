/**
 * A file that stays under the per-file coverage floor, with the reason and its own floor.
 * `lines` and `functions` are fractions set to the measured value; the gate fails when the file drops below them.
 */
export interface CoverageException {
  readonly file: string;
  readonly reason: string;
  readonly lines: number;
  readonly functions: number;
}

/**
 * Files allowed under the per-file floor of 97% lines and 98% functions.
 * Add a test instead of adding an entry; remove an entry as soon as its file meets the floor.
 */
export const coverageExceptions: readonly CoverageException[] = [
  {
    file: "packages/aokit/src/cli/commands/add.ts",
    reason:
      "remaining guards are shadowed by the base render, which fails first with the same error, so no input reaches them",
    lines: 429 / 448,
    functions: 54 / 56,
  },
  {
    file: "packages/aokit/src/pipeline/render.ts",
    reason:
      "the `random: () => 0` seam is never called by the pipeline, which only reads it as a default",
    lines: 1,
    functions: 10 / 11,
  },
];
