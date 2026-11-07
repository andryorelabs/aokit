# Competitors

What the neighbouring tools do and where aokit differs. Terms follow [GLOSSARY.md](../../GLOSSARY.md). Every statement about another tool cites a source: an upstream page or a research page of this repository. Where the research did not verify something, this page says so instead of claiming it.

## Summary

| Tool          | What it does, as sourced                                                   | Where aokit differs                                                                   |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| create-t3-app | Generates a project from a base template plus per-option installers        | Options are declarative Module manifests, and there is a later `add` and `update`     |
| projen        | Records generated files in a manifest under `.projen/`                     | Files stay the user's own and updates merge with their edits through the Lockfile     |
| Nx generators | Edit an in-memory tree with a change list, provenance and an atomic commit | aokit borrows those ideas for its Plan, and adds a Lockfile and a Registry of Modules |
| copier, cruft | Update a project from a template by re-rendering and merging               | The unit is a Module, so one Module can be added or removed on its own                |
| Yeoman        | Runs generators written as code                                            | Modules are declarative manifests with Ops, so a change can be planned and diffed     |
| plop          | Runs prompts and actions defined in a plopfile                             | aokit records what it wrote and updates it later                                      |

## create-t3-app

Does: a base template holds the files every project gets, and one installer per option copies prewritten variant files and edits `package.json`. After generation the tool leaves the project alone.

Differs: aokit declares each option as a Module manifest with Capabilities and Extension points, so a new option does not mean editing existing installers. Projects can be changed after generation with `add`, `remove` and `update`.

Sources: [scaffolding-landscape.md](../research/scaffolding-landscape.md), upstream <https://github.com/t3-oss/create-t3-app>. The structural description comes from a local clone read during research and was not re-verified against upstream HEAD.

## projen

Does: projen keeps a manifest of generated files under `.projen/`.

Differs: aokit writes ordinary files the user owns and merges updates with their edits, using the per-file hashes in the Lockfile ([Lockfile](../architecture/lockfile.md)). The research in this repository records nothing else about projen, so this page makes no further claim.

Sources: [lifecycle-and-versions.md](../research/lifecycle-and-versions.md), <https://projen.io/docs/introduction/>.

## Nx generators

Does: an in-memory tree records a change list of create, update, delete and rename operations with provenance, conflicts fail by default, and the commit is atomic.

Differs: aokit adopts the same ideas for its Plan and writes ([ADR 0012](../adr/0012-deterministic-generation-and-atomic-writes.md)), and adds a Registry of Modules and a Lockfile for later updates. `nx migrate` moves a workspace between Nx versions, which is a different job from composing a Project.

Sources: [engine-and-registry.md](../research/engine-and-registry.md), <https://nx.dev/extending-nx/recipes/local-generators>, <https://nx.dev/features/automate-updating-dependencies>.

## copier and cruft

Does: copier updates a project by rendering the previous template version, diffing it against the user's files, applying the new version and using a 3-way merge for rejected hunks. cruft records the template commit in `.cruft.json`.

Differs: aokit uses a comparable merge for `update` ([ADR 0003](../adr/0003-remove-by-rerender-and-three-way-merge.md), [ADR 0016](../adr/0016-update-moves-a-project-between-releases.md)). The unit it updates is a set of Modules from a Registry, not one template.

Sources: [lifecycle-and-versions.md](../research/lifecycle-and-versions.md), <https://copier.readthedocs.io/en/stable/updating/>, <https://cruft.github.io/cruft/>.

## Yeoman and plop

Does: Yeoman runs generators written as code, and plop runs actions from a plopfile. Both are code-driven generators.

Differs: a Module is data, so aokit can plan, diff and verify a change before it writes. The research in this repository did not review Yeoman or plop in depth, so this page compares nothing beyond how they are driven.

Sources: upstream <https://yeoman.io> and <https://plopjs.com>.

## What aokit does not claim

- It does not claim to be the first or the only tool that updates generated projects.
- It makes no speed, popularity or adoption claim about itself or others.
- Better-T-Stack is covered in [scaffolding-landscape.md](../research/scaffolding-landscape.md) and is not compared on public surfaces.
