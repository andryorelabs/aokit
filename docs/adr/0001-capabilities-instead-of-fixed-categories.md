# 0001. Capabilities instead of fixed categories

Status: Accepted (2026-11-03)
Spec: S5 (AO-2673), also S2
Architecture: [Capabilities](../architecture/capabilities.md), [Module contract](../architecture/module-contract.md)

## Context

A scaffolder must decide which option combinations are legal. create-t3-app and Better-T-Stack organize options into fixed categories (database, ORM, auth, API) with compatibility rules written per combination, and their templates branch on those choices. Adding one option means editing shared rules and templates, which is the cost [CONTEXT.md](../../CONTEXT.md) rules out: adding a Module must never edit other Modules. See the [scaffolding landscape](../research/scaffolding-landscape.md).

## Decision

A Module declares what it `provides` and `requires` as named Capabilities, each with a Cardinality (`orm` at most one, `deploy` many). Compatibility is derived from these declarations: requirements satisfied, Cardinality respected, no `conflicts`, acyclic. There is no table of valid combinations and no fixed category list. Capability names describe what is offered, never who offers it (`requires: ["orm"]`, not `"prisma"`). `conflicts` stays only for what Capabilities cannot express, such as two Modules writing the same exclusive file. A Module can never require a Layout.

## Consequences

- A new Module joins the compatibility matrix by declaring itself; no existing Module or rule changes. The CI matrix is generated from the same declarations.
- Capability naming becomes a governance task: names are owned by the Registry that first uses them, and Cardinality disagreements surface as Registry warnings.
- The model cannot express a preference ("prefer X when several providers exist"); the Resolver never auto-adds a requirement when more than one provider exists and asks instead.
- Error messages must be written from the declarations (Module, Capability, fix), which costs effort but replaces hand-written per-combination messages.

## Alternatives considered

- **Fixed categories with per-combination compatibility rules** (the Better-T-Stack model): rejected because every new option edits shared rules, and the rule count grows combinatorially.
- **Naming concrete providers in `requires`** (`requires: ["prisma"]`): rejected because it couples Modules to each other and defeats substitution.
- **Free-form tags without Cardinality**: rejected because "at most one ORM" would again need hand-written rules.
