# Testing

Tests run with `bun test`, through `bun run test`. Coverage is on by default and gated by a floor, so a regression fails the same command that runs the tests.

## Coverage threshold

`bunfig.toml` enables coverage, sets `coverageSkipTestFiles` so test files do not count toward their own score, and sets `coverageThreshold` for lines and functions. The values are the measured coverage rounded down to two decimals.

The policy has two halves:

- Add tests instead of lowering the threshold.
- Raise the threshold when coverage rises, so the gain cannot silently erode.

A threshold is never lowered to make a gate pass. Bun reports coverage per run; measure with `bun test --coverage` before changing the value.

## Coverage manifest

`tools/coverage/coverage-manifest.test.ts` requires every `packages/*/src/**/*.ts` module to be imported directly by at least one `*.test.ts`, or to be listed in `tools/coverage/coverage-exemptions.ts` with a non-empty reason.

- A new module with no importing test and no exemption fails the test.
- An exemption with an empty reason fails.
- A stale exemption fails: one that names a module that no longer exists, or one that a test now imports. Delete the entry when you add the test.

An exemption records why a module has no direct test, such as a process entry point that only spawned-CLI tests reach. It is a last resort; prefer writing the test.

## Related

- [Tooling](tooling.md) covers the lint and format gates that run alongside tests in `bun run check`.
- Terms follow [GLOSSARY.md](../../GLOSSARY.md).
