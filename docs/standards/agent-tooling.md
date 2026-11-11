# Agent tooling

The files that configure agents in a repo. Index: [standards](README.md). Agent entry files are in [docs and emet](docs-and-emet.md#agent-files). Terms follow [GLOSSARY.md](../../GLOSSARY.md).

Each rule is marked **must** or **should**, gives one sentence, then the reason.

- **H1** (must) `emet.config.json` has no init comment, carries the hosted `$schema` once emet ships it, sets `pr` and `models` explicitly (values per repo), names the current ticket prefix, freezes the bootstrap and runs `check` and `test` as the self-check. Reason: an unattended run must not depend on defaults.
- **H2** (must) The committed `.claude/settings.json` denies trunk pushes and tracker deletes, and a test covers the `rm` guard. Reason: an agent cannot damage trunk or the tracker even when it errs.
- **H3** (must) `skills-lock.json` matches the installed skills. Reason: every session runs the same skill versions.
- **H4** (must) `.gitignore` covers `.emet/`, `.claude/worktrees/`, `.env` and `.env.keys`. Reason: run state, worktrees and secrets never reach a commit.
