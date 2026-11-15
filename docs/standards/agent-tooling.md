# Agent tooling

The files that configure agents in a repo. Index: [standards](README.md). Agent entry files are in [docs and emet](docs-and-emet.md#agent-files). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

Each rule is marked **must** or **should**, gives one sentence, then the reason. Rules from standard v2 carry their V number and project types, defined in the [legend](README.md#levels-and-project-types).

- **H1** (must) `emet.config.json` has no init comment, carries the hosted `$schema` once emet ships it, sets `pr` and `models` explicitly (values per repo), names the current ticket prefix, freezes the bootstrap (the `worktree.bootstrap` commands install from the lockfile, such as `bun install --frozen-lockfile`, and never rewrite it) and runs `check` and `test` as the self-check. Reason: an unattended run must not depend on defaults.
- **H2** (must) The committed `.claude/settings.json` denies trunk pushes and tracker deletes, and a test covers the `rm` guard. Reason: an agent cannot damage trunk or the tracker even when it errs.
- **H3** (must) `skills-lock.json` matches the installed skills. Reason: every session runs the same skill versions.
- **H4** (must) `.gitignore` covers `.emet/`, `.claude/worktrees/`, `.env` and `.env.keys`; a dotenvx-encrypted `.env` may be committed under H6. Reason: run state, worktrees and secrets never reach a commit.
- **H5** (V43, should bin, may all) A repo runs `dependency-review` on pull requests, runs `step-security/harden-runner` and attaches an SBOM to released binaries; it is a should for a repo that ships binaries and a may for every other repo. Reason: a new dependency, a runner and a binary's contents are inspectable.
- **H6** (V44, must, all) H4 allows a dotenvx-encrypted `.env` when a pre-commit guard blocks `.env.keys`. Reason: encrypted config can be committed while its keys never are.
