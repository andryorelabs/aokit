# Lifecycle and version findings

Findings only. Decisions are in `docs/architecture/` (not yet written; links will be added once it exists). `raw-notes.md` = [raw-notes.md](raw-notes.md); line numbers refer to it.

## Update algorithms

### Copier `update`

Source: read from Copier's source (raw-notes.md L39); <https://copier.readthedocs.io/en/stable/updating/>.

1. Render the previously used template version.
2. Diff that render against the user's current files.
3. Apply the new template version.
4. Use `git merge-file` as a 3-way merge for rejected hunks; index stages are used for conflicts.
5. User deletions are respected.
6. Migrations run before or after the update, selected by version ranges.

Ideas the research flags as worth borrowing: two-phase `update --plan` / `--apply`, per-module migrations as in-memory file migrations that can also migrate answers, and a renames manifest (raw-notes.md L39).

### cruft, Projen, nx migrate, ng update

The notes list these as reviewed; the only concrete findings recorded concern their lockfile or state designs (below) and the migration idea from Nx/Angular. Nothing else is recorded, so nothing else is claimed.

- cruft: <https://github.com/cruft/cruft>
- Projen: <https://projen.io>
- `nx migrate`: <https://nx.dev/features/automate-updating-dependencies>
- `ng update`: <https://angular.dev/cli/update>

## Three-way merge options (raw-notes.md L41)

- `git merge-file`: the primary option; handles text, produces conflict markers. <https://git-scm.com/docs/git-merge-file>
- `node-diff3`: pure-JS fallback when git is unavailable. <https://github.com/bhousel/node-diff3>
- Edge cases the research lists: binary files, JSON (structural 3-way), package-manager lockfiles (never merged, reinstall instead), delete-versus-modify, LF normalization, file modes.

## `remove` precedents (raw-notes.md L42)

The research concludes that inverse operations are unreliable and that re-rendering without the module followed by a 3-way merge is a workable approach. Dependencies are removed only when no other module needs them, and dependents are checked first. Which tools were examined for `remove` precedents is not recorded in the notes; none are cited.

## Dependency versions

### Catalogs

- Bun catalogs: <https://bun.sh/docs/install/catalogs>. Quirk recorded in the research: `catalog:default` misbehaves, so bare `catalog:` is the safe spelling (raw-notes.md L43). Unverified against a specific Bun version.
- pnpm catalogs exist (<https://pnpm.io/catalogs>); the audit found pnpm only in legacy repos (raw-notes.md L79).

### Renovate

- Renovate does not support Bun catalogs; the upstream pull request is open as PR #42909 (raw-notes.md L43). Repository: <https://github.com/renovatebot/renovate>; the PR number is quoted from the notes and its state was not re-checked here.
- Workaround recorded: keep the registry's catalog as `catalog/<release>.json` and update it through a jsonata `customManager` (<https://docs.renovatebot.com/modules/manager/custom/>), with `rangeStrategy` pin, `minimumReleaseAge` and grouped updates (raw-notes.md L43).
- What the reference repos actually do today: [reference-repos-audit.md](reference-repos-audit.md#renovate-and-ranges).

## Lockfile designs of generators

The notes describe the state fields the research wants a lockfile to carry (raw-notes.md L44): an integer `lockfileVersion`, `$schema`, chained migrations, `minCliVersion` per registry release, per-module version/registry/integrity/answers, a per-file map with owners, mode and hash, dependency records, sorted keys and no timestamps. Old module versions must remain fetchable.

Comparison of existing generators' state files:

- Copier: `.copier-answers.yml` (<https://copier.readthedocs.io/en/stable/configuring/#the-copier-answersyml-file>)
- cruft: `.cruft.json` recording template commit (<https://cruft.github.io/cruft/>)
- Better-T-Stack: `bts.jsonc`, see [scaffolding-landscape.md](scaffolding-landscape.md#better-t-stack)
- Projen: a manifest of generated files (`.projen/`), <https://projen.io/docs/introduction/>

The file names above are general knowledge, not recorded in the raw notes; field-level contents were not captured. Treat as unverified until checked against the linked docs.
