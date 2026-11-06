# 0022. The aokit repo configures Oxlint and Knip in TypeScript and JSONC, generated Projects keep JSON

Status: Accepted (2026-11-06)
Spec: S16 (cross-repo practices spec)
Architecture: [Tooling standard](../standards/tooling.md), [Module catalog](../architecture/module-catalog.md)

## Context

[ADR 0008](0008-oxc-default-with-eslint-companion.md) makes Oxc the default tooling. The aokit repo needs a strict, explained lint policy: many type-aware rules, local rules, and a reason for every rule group. The reference repos (streamboss, snug, animated-fluent-emojis, andryore-web) write `oxlint.config.ts` for this. The `oxc` Module is different: it declares `lint.ignores` as a `json` Extension point in `.oxlintrc.json`, and the engine patches it by JSON pointer ([ADR 0002](0002-extension-points-and-declarative-ops.md)). A TypeScript config cannot be patched that way. Oxlint 1.90 supports both forms: `defineConfig` accepts a TypeScript config, and the JSON config accepts comments.

## Decision

- **The aokit repo** configures Oxlint in `oxlint.config.ts` with `defineConfig`, and Knip in `knip.jsonc`. Each rule group carries a TSDoc rationale, shared policy values are constants, and a test imports the config to assert the key policies.
- **Generated Projects** keep `.oxlintrc.json` and `knip.json` from the `oxc` and `knip` Modules. Their Extension points stay JSON and are patched by pointer.
- **The two configs are independent.** The repo config is not a source for the Module files, and a rule added to one is not copied to the other without its own decision.

## Consequences

- The repo's lint policy is typed, commented per rule group and testable.
- Local rules and policy constants are shared in TypeScript instead of repeated as strings.
- The repo's own config is not an example of what `create` generates, so a change to the Module's config is made and tested in `registry-src/oxc` itself.
- Contributors read two config shapes: TypeScript in the repo, JSON in generated Projects.

## Alternatives considered

- **JSON with comments for the repo**: rejected. Oxlint accepts comments, but the file cannot share constants and a test cannot import it.
- **TypeScript config in generated Projects too**: rejected. It would remove the `lint.ignores` Extension point, because the engine patches JSON by pointer and does not edit TypeScript for config objects it does not own.
- **Choosing per repo with no record**: rejected. Two layouts of lint config in one repo and its generated Projects would be learned by accident.
