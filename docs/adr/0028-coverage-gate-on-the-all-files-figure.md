# 0028. The coverage gate checks the All files figure

Status: Accepted (2026-11-11)
Spec: S22 (post-0.1.0 readiness spec)
Architecture: [Testing standard](../standards/testing.md#coverage-threshold)

## Context

`bunfig.toml` set `coverageThreshold = { line = 0.97, function = 0.98 }` and the suite still exited 0 at 94% lines. Bun 1.4.4 only reads the keys `lines` and `functions`; it ignores `line` and `function` without an error. Fixing the keys is not enough either: Bun applies the threshold to every file on its own, not to the "All files" row, which is only the mean of the per-file percentages. Per file, 81 of 264 files are under 97% lines or 98% functions, and some can only be covered with Docker or Chromium (`tools/docker-smoke/main.ts`, the cover export in `tools/brand/brand-export.ts`).

## Decision

- `bunfig.toml` keeps coverage on and writes `coverage/lcov.info`; it no longer sets `coverageThreshold`.
- `bun run test` runs `bun test` and then `tools/coverage/check-threshold.ts`. The script computes the "All files" line and function figures from the lcov report and exits 1 when either is below its threshold.
- The thresholds stay at 97% lines and 98% functions, as constants in the script. Raising them follows the [testing standard](../standards/testing.md); lowering them to pass is not allowed.
- Files are never added to `coveragePathIgnorePatterns` to pass the gate. Only test support code and temp registries are excluded.

## Consequences

- A run below the threshold fails the same command that runs the tests, as the standard already promised.
- A file with low coverage no longer fails the run on its own as long as the mean holds. The coverage manifest still requires every source module to be imported by a test or exempted with a reason.
- The gate is a script, so the Windows and latest-Bun CI lanes that call `bun test` directly do not run it; the Linux `bun run test` lane is the gate.

## Alternatives considered

- **Fix the keys and keep Bun's per-file threshold**: rejected for now. It needs the 81 files covered first and still cannot cover the Docker and Chromium files without ignoring them.
- **Lower the threshold or ignore the low files**: rejected. It hides the gap instead of closing it.
