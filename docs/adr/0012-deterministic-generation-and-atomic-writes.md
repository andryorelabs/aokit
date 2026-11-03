# 0012. Deterministic generation and atomic writes

Status: Accepted (2026-11-03)
Spec: S3 (AO-2673)
Architecture: [Engine: determinism](../architecture/engine.md#determinism), [Engine: atomic writes](../architecture/engine.md#atomic-writes), [Distribution: CI determinism](../architecture/distribution.md#ci-determinism-on-linux-and-macos)

## Context

Plans are hashed, compared and snapshotted, and `update` re-renders old states, so the same inputs must give the same bytes on any machine. A crash or Ctrl+C must never leave a half-written Project.

## Decision

Generation is deterministic: canonical topological Module order with Unicode codepoint tie-break, sorted emission, serial Ops, `now`/`random`/`env` injected through a context, volatile values excluded from hashes, LF everywhere, a pinned format phase using the Project's formatter Module, and no install inside the deterministic phase. Apply writes the Plan to a temporary directory and renames it into place, writing the Lockfile last; on SIGINT or error the temporary directory is removed. CI generates each curated Project twice and compares digests on Linux and macOS, for the npm build and the binary.

## Consequences

- Snapshot testing and hash comparisons are reliable.
- No Module may read globals, parallelize Ops or depend on `node_modules`.
- The formatter version becomes part of the output contract.
- The temp-dir-then-rename design needs the temporary directory next to the target.

## Alternatives considered

- **Best-effort determinism**: rejected because snapshots and the upgrade job would flake.
- **Writing in place**: rejected because an interrupted process can leave a half-written Project.
- **Installing inside generation**: rejected because output would depend on the network and Registry state.
