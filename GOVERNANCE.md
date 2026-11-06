# Governance

This document describes how aokit is governed today: who decides what, how changes get made, and what happens if the maintainer goes away.

## Model: single maintainer

[@AndryOre](https://github.com/AndryOre) is the sole maintainer and has final say over all technical and project decisions, including scope, architecture, and what gets merged.

## Decision process

1. **Issue first.** Most changes start as a GitHub issue (bug report, feature request, or proposal) so the "why" is on the record before any code is written.
2. **Pull request.** Implementation happens in a pull request against `main`. Every PR must pass CI before it can be merged (see [`CONTRIBUTING.md`](CONTRIBUTING.md)). Pull requests are merged via **squash merge only**, keeping a linear history.
3. **ADR for hard-to-reverse choices.** Decisions that are expensive to reverse are recorded as an Architecture Decision Record under [`docs/adr/`](docs/adr/README.md), not just discussed in a PR description.

## Roles and responsibilities

### Maintainer

The maintainer triages issues, reviews and merges pull requests, cuts releases, makes final calls on scope and design, and is responsible for the project's security posture (see [`.github/SECURITY.md`](.github/SECURITY.md)).

### Contributor

Anyone who opens an issue, submits a pull request, or participates in discussion is a contributor. Contributors are expected to follow [`CONTRIBUTING.md`](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## Continuity

There is currently no backup maintainer. If @AndryOre becomes unavailable for an extended period, the project may pause until the maintainer returns. The code is open source, so anyone can fork it if the pause becomes permanent.

## Code of Conduct

All participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
