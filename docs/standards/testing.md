# Testing

Tests run with `bun test`, through `bun run test`. Coverage is on by default and gated by a floor, so a regression fails the same command that runs the tests.

## Coverage threshold

`bunfig.toml` enables coverage, sets `coverageSkipTestFiles` so test files do not count toward their own score, and writes an lcov report next to the text table. `bun run test` runs `bun test` through `tools/coverage/run-tests.ts` and then `tools/coverage/check-threshold.ts`, which fails the command when the "All files" line or function coverage is below `LINE_THRESHOLD` (99.7%) or `FUNCTION_THRESHOLD` (99.9%). The figure is the mean of the per-file percentages, the same number as the "All files" row of the table. A filtered run (`bun run test <path>`) measures part of the suite and skips the gate. See [ADR 0028](../adr/0028-coverage-gate-on-the-all-files-figure.md).

The policy has two halves:

- Add tests instead of lowering the threshold.
- Raise the threshold when coverage rises, so the gain cannot silently erode.

A threshold is never lowered to make a gate pass, and a file is never added to `coveragePathIgnorePatterns` to hide it. Measure with `bun run test` before changing the value.

## Per-file floor and exceptions

The same check compares every file in the report with a floor of 97% lines and 98% functions, so a low file cannot hide behind the mean. A file under the floor fails the run, and the message names the file and both figures.

A file that cannot reach the floor is listed in `tools/coverage/coverage-exceptions.ts`. Each entry has the file path, a non-empty reason, and its own line and function floor set to the measured value. The check fails on an exception when:

- its file is missing from the report;
- its file now meets the floor, so the exception is stale and must be deleted;
- its reason is empty;
- its file is under the entry's own floor.

An exception is a last resort for code a test cannot reach, such as a branch shadowed by an earlier failure. Prefer writing the test, and never lower an entry's floor to make the gate pass.

## Coverage manifest

`tools/coverage/coverage-manifest.test.ts` requires every `packages/*/src/**/*.ts` module to be imported directly by at least one `*.test.ts`, or to be listed in `tools/coverage/coverage-exemptions.ts` with a non-empty reason.

- A new module with no importing test and no exemption fails the test.
- An exemption with an empty reason fails.
- A stale exemption fails: one that names a module that no longer exists, or one that a test now imports. Delete the entry when you add the test.

An exemption records why a module has no direct test, such as a process entry point that only spawned-CLI tests reach. It is a last resort; prefer writing the test.

## Gate rule

- **E3** (must) Coverage has a rising gate, and a coverage manifest covers every source module of every package. Reason: a gain cannot erode, and no module hides from the gate.
- **E4** (must) Every file meets 97% lines and 98% functions unless it is a listed coverage exception with a reason and its own floor. Reason: the mean cannot hide a low file.

## Related

- [Tooling](tooling.md) covers the lint and format gates that run alongside tests in `bun run check`.
- Terms follow [GLOSSARY.md](../../GLOSSARY.md).
