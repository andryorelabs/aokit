# 0015. Lifecycle outcomes are error codes with data

Status: Accepted (2026-11-03)
Spec: S3 (Spec: Phase 4a, lifecycle foundations)
Architecture: [CLI UX: lifecycle outcomes](../architecture/cli-ux.md#lifecycle-outcomes), [Lifecycle: doctor](../architecture/lifecycle.md#doctor), [Lifecycle: check](../architecture/lifecycle.md#check)

## Context

Several lifecycle results are neither a plain success nor an unexpected failure. `doctor` found drift, `check` found an update, a merge left conflicts. Each must set a non-zero exit code so CI can gate on it, and each also has a report the caller needs. The first `--json` envelope only allowed `data` on success and `error` with `data: null` on failure, and the exit code is derived from `error.code` alone ([ADR 0009](0009-one-zod-schema-for-all-interfaces.md)). A second, parallel "outcome" channel would give every consumer two ways to read a result and would let the exit code and the payload disagree.

## Decision

A lifecycle outcome is an error code that carries data. The envelope allows `ok: false` with a non-null `data` report, and the exit code still comes only from `error.code`. The outcome codes are `DRIFT` (exit 1, the `doctor` report), `UPDATE_AVAILABLE` (exit 2, the Modules with current and available versions) and `MERGE_CONFLICTS` (exit 6, the conflicted paths with provenance). The codes the lifecycle commands need are defined together up front (`NOT_IN_LOCKFILE`, `NOT_SELECTED`, `DEPENDENTS_EXIST`, `MODULE_VERSION_UNAVAILABLE`, `MIN_CLI_VERSION`), so adding a command never edits the code table. A Resolver rejection keeps its raw Resolver code as data (`error.data.resolverCode`). `doctor` is read-only and has no `--fix`; the report names the command that fixes each problem.

## Consequences

- One shape for every result: scripts read `ok`, `error.code` and `data`, and the exit code always agrees with `error.code`.
- CI gates on `check` (exit 2) and `doctor` (exit 1) while still receiving the full report on stdout.
- The output schema of a command that has outcomes describes `data` for both the success and the outcome case.
- A consumer must not treat `ok: false` as "no data"; it checks `data` before falling back to the message.
- Exit code 2 stays reserved for `UPDATE_AVAILABLE`, so no other command may use it.

## Alternatives considered

- **A separate `outcome` field next to `error`**: rejected because it adds a third state to the envelope and lets the exit code and the outcome disagree.
- **Report on stderr, code only in the envelope**: rejected because `--json` must be one document on stdout and agents should not scrape stderr.
- **`doctor --fix`**: rejected for now because a fix is a write, and every write goes through a Plan, a clean tree and a Lockfile update; the report prints the exact command instead.
