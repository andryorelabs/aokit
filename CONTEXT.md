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
The Modules, and the file entry or Op, that caused a change in a Plan.
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

**Lockfile**:
`aokit.lock.json`, the recorded state of a project: CLI and protocol version, layout, modules with exact version, source and integrity, answers, per-file hash and ownership mode, dependency pins.
_Avoid_: config, manifest (a manifest describes a module, not a project)

**Ownership mode**:
Per generated file, one of `managed` (regenerated and 3-way merged), `seed` (written once), or `ejected` (the user's, never touched again).
_Avoid_: lock state, protection level

**Plan**:
The reviewable result of resolving a configuration into file changes before anything is written (`create --dry-run`, `update --plan`).
_Avoid_: preview, dry run output

**Virtual file system (VFS)**:
The in-memory tree where a plan is built; it is written to disk atomically only on apply.
_Avoid_: staging area, temp tree

**Release**:
A versioned, immutable snapshot of a Registry: its Modules and the one Catalog tested with them (`2026.11.0`).
_Avoid_: version (of a Registry), drop, channel

**Catalog**:
The set of dependency versions a Release ships, tested together.
_Avoid_: version map, bill of materials

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
- The Lockfile assigns every generated file an **Ownership mode**.
- A **Registry** publishes **Releases**; each Release has one **Catalog**; the **Toolchain pin group** is the part of the Catalog pinned exactly.

## Flagged ambiguities

- "preset" is deliberately absent: reusable selections are the Lockfile of a real project (`create --from`), not a maintained bundle.
- "template" means only a Module's plain source files; it never means a bundle of choices.
