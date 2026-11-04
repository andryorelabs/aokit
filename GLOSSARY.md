# aokit

aokit is a Bun-only scaffolding CLI that turns a selection of modules into a TypeScript project and keeps that project updatable afterwards.

## Language

**Module**:
A unit of capability that can be added to or removed from a project, declared as a manifest.
_Avoid_: plugin, preset, template, feature flag

**Capability**:
A named thing a module provides or requires (`orm`, `db:postgres`, `auth`, `api:rpc`, `test-runner`).
_Avoid_: category, option

**Cardinality**:
How many modules may provide one capability in a project (`orm` at most one, `deploy` many).
_Avoid_: limit, multiplicity

**Extension point**:
A named, versioned slot declared by a base module where other modules contribute (`web.providers`, `server.middleware`, `env.schema`).
_Avoid_: hook, slot

**Op**:
A declarative edit a module applies at an extension point or to a file (`addImport`, `addToArray`, `registerAt`, `mergeJson`).
_Avoid_: codemod, patch, transform

**Anchor**:
The stable locator of an Extension point inside its Target's files, such as a top-level declaration name; contributors never see the file path.
_Avoid_: marker, hook point

**Provenance**:
The Modules (or aokit itself, for its own Regions), and the file entry or Op, that caused a change in a Plan.
_Avoid_: origin, blame

**Target**:
A logical destination a module writes to (`web`, `server`, `shared-ui`, `db`), never a path.
_Avoid_: folder, path

**Layout**:
The mapping from targets to paths for one project, either `single` (one package) or `monorepo`; chosen by the user and never forced by a module.
_Avoid_: structure, topology

**Registry**:
A source of module manifests that is versioned and integrity-checked: official, local, remote, or shadcn-adapted.
_Avoid_: store, marketplace

**Adapted Module**:
A Module synthesised from a shadcn Registry item, declarative only, named `@namespace/item` and versioned `0.0.0-shadcn.<12hex>`; it follows the same Plan, Lockfile and lifecycle as a native Module.
_Avoid_: shadcn component, imported item

**Namespace**:
An `@name` configured under `registries` in the user config that addresses a shadcn Registry by a URL template and optional headers.
_Avoid_: scope (a Namespace is configured, not published), alias

**Trusted Registry**:
A Registry whose content may run in a Project: the official and local Registries, and any other one the user allowed by the user config, `--trust` or the Project's Lockfile.
_Avoid_: verified Registry, safe Registry

**Yanked version**:
A Module version that stays served and verified for Lockfiles that already pin it, but is never selected for a new `add`, `create` or `update`.
_Avoid_: deprecated version, deleted version

**Pin**:
The full commit SHA a git-hosted Registry source is fixed to; only an explicit `update --registry` moves it.
_Avoid_: lock, freeze

**Lockfile**:
`aokit.lock.json`, the recorded state of a project: CLI and protocol version, layout, modules with exact version, source and integrity, answers, per-file hash and ownership mode, dependency pins.
_Avoid_: config, manifest (a manifest describes a module, not a project)

**Ownership mode**:
Per generated file, one of `managed` (regenerated and 3-way merged), `seed` (written once), or `ejected` (the user's, never touched again).
_Avoid_: lock state, protection level

**Region**:
A span of a Markdown file between aokit begin and end markers, owned by one Module or by aokit itself; aokit rewrites only its Regions.
_Avoid_: block, managed section

**Region file**:
A managed file made of Regions plus the user's own text, such as `AGENTS.md` and `CLAUDE.md`.
_Avoid_: mixed file

**Agent files**:
`AGENTS.md`, `CLAUDE.md` and the Skills of a Project, which tell coding agents how the Project is built.
_Avoid_: AI docs, agent config

**Skill**:
A `.claude/skills/<name>/SKILL.md` file a Module ships to teach an agent one workflow of that Module.
_Avoid_: recipe, playbook

**Plan**:
The reviewable result of resolving a configuration into file changes before anything is written (`create --dry-run`, `update --plan`).
_Avoid_: preview, dry run output

**Virtual file system (VFS)**:
The in-memory tree where a plan is built; it is written to disk atomically only on apply.
_Avoid_: staging area, temp tree

**Render**:
The virtual file system a selection of Modules produces at given versions and answers, built from an empty tree.
_Avoid_: build output, generated copy, snapshot

**Drift state**:
How one file in a Project compares with what aokit last wrote: `pristine`, `modified`, `deleted`, `unknown` or `volatile`.
_Avoid_: status, dirty flag, diff state

**Merger**:
The three-way merge of base, user and new for one file.
_Avoid_: patcher, conflict resolver

**Selected Module**:
A Module the user chose, as opposed to one pulled in only because another Module requires its Capability.
_Avoid_: explicit module, top-level module, direct dependency

**Conflict**:
A merge result that needs a human, shown as conflict markers in the file or a `.aokit-new` copy beside it.
_Avoid_: error, failure

**Release**:
A versioned, immutable snapshot of a Registry: its Modules and the one Catalog tested with them (`2026.11.0`).
_Avoid_: version (of a Registry), drop, channel

**Catalog**:
The set of dependency versions a Release ships, tested together.
_Avoid_: version map, bill of materials

**Migration**:
A VFS codemod shipped with a Module version that carries a Project across a change a re-render cannot, and may migrate the Module's answers.
_Avoid_: upgrade script, codemod, hook

**Renames manifest**:
A Module version's map from the previous version's paths to its own, relative to a Target, so the user's edits follow a moved file.
_Avoid_: move list, path map

**Upgrade job**:
The CI check that a Project created at one Release, with representative edits, updates to the next Release with zero Conflicts.
_Avoid_: upgrade test, migration test

**Toolchain pin group**:
Dependencies pinned exactly regardless of the default range policy (the oxc packages, the TypeScript 7 alias).
_Avoid_: locked deps, frozen deps

**Project**:
One generated repository. Integration between separate projects is out of scope.
_Avoid_: app, workspace

## Relationships

- A **Module** provides and requires **Capabilities**; each Capability has a **Cardinality**.
- A base **Module** declares **Extension points**; other Modules contribute to them with **Ops**.
- A Module writes to **Targets**; the **Layout** resolves each Target to a path.
- A **Plan** is built in the **VFS** and applied atomically; applying records the result in the **Lockfile**.
- The Lockfile assigns every generated file an **Ownership mode** and records which Modules are **Selected Modules**.
- A **Render** is built from a selection, or from the Lockfile, and compared with the working tree to give each file a **Drift state**.
- The **Merger** combines the base Render, the user's file and the new Render; what it cannot reconcile is a **Conflict**.
- A **Region file** holds one **Region** per Module plus aokit's header; the Merger replaces Regions and keeps the user's text outside them.
- A **Registry** publishes **Releases**; each Release has one **Catalog**; the **Toolchain pin group** is the part of the Catalog pinned exactly.
- A command fetches only from a **Trusted Registry**; a git-hosted Registry is fetched at its **Pin**, and a **Yanked version** is served but never chosen.
- A Module version may ship **Migrations** and a **Renames manifest**; `update` moves a Project from one Release to another and runs them.

## Flagged ambiguities

- "preset" is deliberately absent: reusable selections are the Lockfile of a real project (`create --from`), not a maintained bundle.
- "marker" means only the begin or end comment of a Region; an Anchor is never a marker.
- "template" means only a Module's plain source files; it never means a bundle of choices.
