# 0013. No telemetry in v1

Status: Accepted (2026-11-03)
Spec: S11 (AO-2673)
Architecture: [Distribution: telemetry](../architecture/distribution.md#telemetry)

## Context

Usage data helps prioritize, but aokit is a personal tool in a public repository, runs inside coding agents and generates source code. The [research](../research/cli-and-tooling.md) finds no telemetry as the baseline, with opt-in possible later.

## Decision

The CLI, the MCP server and generated Projects send no usage data, crash reports or identifiers in v1. The only network calls are the ones the user asked for: Registry fetches, the npm update check and dependency installation. If telemetry is ever added, it is opt-in, off by default, documented in the distribution doc first, and honors `DO_NOT_TRACK=1` and `AOKIT_NO_TELEMETRY=1` regardless of other settings.

## Consequences

- Nothing to disclose or consent to, and no data pipeline to run.
- Prioritization relies on issues and direct feedback.
- Adding telemetry later revises this ADR with a `Revised:` line.

## Alternatives considered

- **Opt-out telemetry**: rejected as hostile to a tool that runs in agents and CI.
- **Opt-in telemetry in v1**: deferred; no need is identified yet.
