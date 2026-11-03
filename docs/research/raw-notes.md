# Raw research notes (seed for docs/research)

Unedited research and decision history from the planning session. Superseded where it conflicts with the architecture docs; tickets turn this into sourced docs.


## Context
Andry wants a personal, public scaffolding CLI (`aokit`) that grows with the stack he actually uses. References: create-t3-app, Better-T-Stack. Goal: adding modules later must never require restructuring. This forge run = docs only (research + architecture + ADRs + CONTEXT.md); implementation in a later forge.

## Settled decisions
- Name: `aokit` everywhere — npm `aokit` + `create-aokit`, bin `aokit`, repo renamed `aokit` (local dir + GitHub). "andryore" = Andry Orellana (never ore/mineral metaphors).
- Positioning: personal, public, grows with Andry's usage; no comparison/competition framing vs Better-T-Stack (Q30 pending confirm).
- Lifecycle: create, add, remove, update (Copier-style 3-way merge), doctor; reproducible command + `create --from <lockfile|url>`. No presets.
- Modules: authored with `defineModule()` in TS → compiled JSON manifest; capabilities (provides/requires/cardinality); versioned extension points declared by base modules; declarative code ops (addImport, addToArray, registerAt) via magicast/ts-morph; arbitrary transforms only from trusted registries.
- Engine: virtual FS, dry-run/diff, deterministic generation.
- Layout: `single` | `monorepo`, user's choice, never forced; modules write to logical targets; optional `layout migrate`. Cross-repo integration NOT documented.
- Registry: own protocol inspired by shadcn + adapter consuming shadcn registry items.
- Versions: pinned exact catalog per registry release (CI-tested, Renovate); `aokit deps unpin [pkg]`; update respects unpinned. State in `aokit.lock.json` (CLI/protocol version, layout, modules+versions+source, answers, resolved versions).
- Interfaces: single Zod schema drives flags, prompts, MCP, possible future web UI. Per-module AGENTS.md sections/skills: designed now, built later.
- Testing: per-module VFS tests, in-memory capability-derived matrix with snapshots, real builds for a curated set.
- CLI stack: TS strict, Bun, citty, @clack/prompts, Zod, magicast + ts-morph, giget; npm + `bun build --compile`.
- Docs: English; docs/research, docs/architecture, docs/adr, CONTEXT.md.
- Example module catalog (illustrative only, from Andry's repos): Astro, Next.js, Vite+React, Hono, Turborepo+Bun catalogs, Tailwind v4, shadcn, Prisma(pg), Better Auth, @t3-oss/env, dotenvx, Zod, ESLint+Prettier, husky+lint-staged+commitlint, knip, Playwright+axe, Vitest, PostHog, Resend/react-email, Trigger.dev, next-intl.
- Forge infra: Linear team `AO`, project "AndryOre Starter" (P-AO-4); private GitHub repo `AndryOre/aokit`; adjust forge.config.json tracker local→linear in Phase 5.

## Deep research findings (2026-11-01, 3 agents, context7 + web) — to fold into docs
- CLI: BTS already uses trpc-cli + oRPC + Zod 4 + clack ^1.8 + @modelcontextprotocol/server 2.3.1 + ts-morph, tsdown → Node ≥22. trpc-cli = schema→flags/prompts/--json/completion, agent detection (v0). citty: no completion, weak help. gunshi rc. @bomb.sh/tab for completion.
- clack v1: group() cancel continues remaining prompts unless onCancel exits; spinner owns SIGINT + exit codes → reconcile exit-code table.
- Zod v4: z.toJSONSchema(io:"input"); custom typed registry z.registry<AokitMeta>() for flag/prompt meta; public inputs must be JSON-Schema-representable. MCP-mode schema: all fields explicit, no stdout.
- Bun compile: set autoloadDotenv/autoloadBunfig false; unresolved dynamic imports not embedded → modules static or assets; avoid native oxc in binary. Ship npm build for Node too (Bun APIs behind adapter).
- MCP SDK v2 registerTool w/ Standard Schema; BTS tools pattern (get_guidance, get_schema, plan, create(destructiveHint), plan_addons, add_addons; {ok,data,error}; plan before create). Add `aokit mcp init --client`.
- Agent files: AGENTS.md root + CLAUDE.md import/symlink; skills .claude/skills/<name>/SKILL.md (agentskills.io).
- Release: npm trusted publishing (OIDC), provenance; binaries w/ SHA256SUMS + attestations. Telemetry: none (opt-in later honoring DO_NOT_TRACK).
- Code edits: internal locate→splice engine (oxc-parser/ast-grep locate + magic-string splice, original-offset batch edits, overlap detection); magicast only for config-shaped objects; ts-morph optional lazy (TS7 API gap). knitwork for generated snippets. Stable anchors at extension points.
- Non-TS: jsonc-parser (tsconfig), sort-package-json + structural merge, yaml Document API, line-based .env (never overwrite keys), postcss for Tailwind v4 (@import/@plugin/@theme), markdown marker regions.
- Borrow Nx Tree/Angular schematics: change list (create/update/delete/rename) w/ provenance per module/op, conflicts fail by default, atomic commit (temp dir + rename), final pinned format phase.
- No template engine: plain valid source files + minimal {{var}} / __name__ path interpolation; variants = separate files.
- shadcn adapter: 12 item types, alias placeholders, css/cssVars/envVars/font/base.config, registryDependencies 5 address forms, namespaced auth. shadcn has no lockfile/integrity → we add. Version schema ($schema + schemaVersion), explicit `override`.
- Determinism: canonical topo order + codepoint tie-break, sorted emission, serial ops, injected now/random/env context, volatile class (secrets) excluded from golden hashes, LF, pinned formatter, no install in deterministic phase, CI generate-twice hash compare.
- Update (Copier source): render old version→ diff old→user → apply new → git merge-file 3-way for rejects, index stages; respects user deletions; migrations before/after with version ranges. Borrow two-phase `update --plan/--apply`, per-module migrations as VFS codemods (can migrate answers), renames manifest.
- File ownership modes: managed / seed / ejected + per-file checksums → doctor drift, fast-path, safe remove; `aokit eject`, `restore`, `diff`, `check` (CI exit 2), `recopy`, `update --abort`; clean-tree precondition.
- Merge: Merger interface: git merge-file primary, node-diff3 fallback; binary → .aokit-new copy; JSON structural 3-way; never merge pm lockfiles (reinstall); delete-vs-modify keeps + warns; LF normalize; file modes.
- remove = render-without-module + 3-way merge (not inverse ops); deps removed only if unused; precheck dependents.
- Renovate does NOT support Bun catalogs (PR #42909 open) → registry catalog as catalog/<release>.json with jsonata customManager, rangeStrategy pin, minimumReleaseAge, grouped; Bun `catalog:default` quirk → emit bare `catalog:`. CI: pairwise matrix × layouts + upgrade job (N-1 → N zero conflicts).
- Lockfile: lockfileVersion int + $schema + chained migrations; minCliVersion per registry release; modules {version, registry, integrity, answers scoped}; files {path: {owners, mode, hash}}; deps {version, pinned, source}; packageManager; sorted keys; no createdAt. Old module versions must stay fetchable forever (immutable + integrity, optional cache).
- Remote registries: sha256 integrity, trust prompt/allowlist, pin giget refs to SHA, no remote scripts without consent.

## Round 6 decisions (all accepted)
- Q30 positioning confirmed; example catalog illustrative only.
- CLI UX doc: docs/architecture/cli-ux.md + ADR (clig.dev principles, --yes/--json/exit codes/--dry-run/--diff, actionable errors, safe Ctrl+C, NO_COLOR/TTY, completion).
- Q31 trpc-cli (behind own command layer) instead of citty.
- Q32 edit engine: oxc-parser/ast-grep locate + magic-string splice primary; magicast configs only; ts-morph optional lazy.
- Q33 remove = render-without-module + 3-way merge.
- Q34 file ownership managed/seed/ejected + per-file hashes; `aokit eject`.
- Q35 develop on Bun; npm package runs on Node ≥22 (Bun APIs behind adapter); compiled binary via Bun.
- Q36 no telemetry v1.
- Q37 final format phase uses project's formatter module (catalog version); none → skip.
- All research findings above are adopted as refinements.

## Cross-repo consensus (in progress)
Peers: andryore-web-13, snug-23, animated-fluent-emojis-9e. I proposed aokit docs hold the consensus.
- andryore-web reply: single-package Astro 7, ESLint strictTypeChecked + plugins, Prettier, husky/lint-staged/commitlint, knip, `bun test` (NOT Vitest) + Playwright/axe, dotenvx only (no t3 env), Renovate RANGES (bump, minReleaseAge 3d), docs/adr living + index test, CLAUDE.md = `@AGENTS.md`, forge trunk `develop` → promotion to main. Research (unapproved): Oxlint+Oxfmt replace ESLint/Prettier except ESLint for *.astro templates (oxc#23207); Oxfmt formats .astro (@astrojs/compiler-rs); TS7 dual layout `typescript: npm:@typescript/typescript6@6.0.2` + `@typescript/native: npm:typescript@7.1.0-beta` keeps JS API for ts-morph/typescript-eslint; Astro typecheck via @astrojs/ts-content-mapper; @oxlint/migrate unreliable → parity gate (StreamBoss parity/*); Renovate Oxc exact pins, no automerge.
- snug reply: AO-2587 Oxlint(--type-aware + jsPlugins aliases for unicorn/jsdoc/local rules, no rule lost)+Oxfmt+TS7.1 (typescript6 catalog + `typescript7` alias exact); parity gate per (file,line,rule); shim for @eslint-react rule. Today: Turborepo+Bun workspaces+catalog (^ ranges, Renovate preserve-semver-ranges, deliberate), Tailwind v4+shadcn+@shadcn/lint, ESLint+Prettier, husky/lint-staged/commitlint (conventional enforced, gitmoji convention), knip, Vitest, Playwright(+axe), docs/adr 30 ADRs w/ index test, CONTEXT.md, docs/architecture.md, AGENTS.md root + per-workspace, CLAUDE.md=@AGENTS.md, .claude/skills; forge linear AO, branchPrefix ao, every ticket needs explicit `project` (sub-issues don't inherit). Comments: TSDoc-only rule (optional module). Disagrees: standard should be Oxlint+Oxfmt (not Biome: can't run unicorn/shadcn rules); default = ranges + lockfile, selective pins for toolchain. Gotchas: @oxlint/migrate broken config; Oxlint overrides lack `ignores`; jsPlugins context frozen; package.json/bun.lock edits serialize forge tickets.
- Implications for aokit: tooling is a module choice (Oxc module + ESLint-for-astro companion), test runner is a capability (bun test | vitest), env module dotenvx standalone, pin policy must be per-project configurable (andryore-web prefers ranges) — reconcile with Q23.

- Consensus proposal v1 sent (C1–C12 agreed, A1–A4 aokit consequences, O1–O6 open for Andry: dep default ranges vs pins, TS7 alias name, leaked-conditional-rendering approach, trunk develop+promotion, test runner, gitmoji enforcement).
- web correction to A1: `eslint-astro` companion must apply EVERY rule the project config applies to *.astro (jsx-a11y 31, unicorn 330 via astro-eslint-parser), not just astro/*. Type-aware jsPlugin rules crash in Oxlint → snug's TS6 Program shim, else a second ESLint companion.

- snug sign-off: C2,C5,C6,C7,C9,C10,C11(n/a),C12,A1,A3,A4. Corrections: C1 add minimal ESLint for no-leaked-conditional-rendering on **/*.tsx (agreed w/ AFE; shim only for repos w/o .astro) — O3 resolved; @astrojs/compiler-rs unverified by snug. C3 NOT agreed: content mapper out of standard until TS 7.1 stable (snug saw 7 false errors on astro 7.3.5); use `astro check` w/ TS6, mapper optional/experimental. C4 minReleaseAge unverified. C8 axe only verified in apps/site. O1 supports ranges+selective pins. O2 majority = `@typescript/native` (web, AFE, snug). O4 snug trunk=main → trunk per repo. O5 per project (snug Vitest). O6 gitmoji = convention, enforcement optional per repo.

- AFE sign-off C1–C12, A1–A4 with corrections: C3 content mapper optional per repo; alias scheme: `typescript` real 6.x from catalog + exact 7.1 alias, scripts call alias bin explicitly + `--version` 7.1 test (bun .bin/tsc may resolve to 6.x); C9 rule name `local/no-non-doc-comments`, exempts tool directive comments (oxlint-*). O1 ranges+selective pins; O2 `@typescript/native` accepted (would take typescript7 if all agree); O3 ESLint minimal pass default, shim only w/o .astro (settled snug+AFE); O4 trunk main, per repo; O5 per project (Vitest Browser Mode); O6 convention only.
- CONSENSUS v2 (all 4 sessions): C1–C12 + corrections above; O3 resolved; for Andry: O1 (3 repos: ranges+selective pins, reverses aokit Q23), O2 alias name, O4 trunk per repo, O5 per project, O6 gitmoji convention-only.

## All-repos audit (2026-11-03, gh api, 51 repos; ~20 active)
Families (what aokit modules/presets-by-usage must cover):
1. Next.js SaaS (streamboss, sdnpanel): Next 16, Prisma 7(+pg adapter), better-auth, @t3-oss/env-nextjs + dotenvx, Trigger.dev, PostHog, next-intl, Base UI + shadcn, Tailwind 4, resend+react-email, zod 4, Docker + Coolify, `bun test`, Playwright, 120+ ADRs, forge trunk `develop`. streamboss = Oxc origin (oxfmt 0.75, oxlint 1.90, tsgolint 7, `typescript: npm:@typescript/typescript6@6.0.2` + alias `typescript7: npm:typescript@7.1.0-beta`, parity/). sdnpanel still ESLint10+Prettier.
2. Vite+React SPAs (mail-sender, nfkit, le-petit-prince): Vite 8, React 19, radix-ui, shadcn, ESLint10+Prettier (NOT Oxc yet), commitlint, no tests; mail-sender has own Hono-ish `server/`; nfkit-api = Hono + tsdown + @t3-oss/env-core.
3. Astro (andryore-web): Astro 7, React islands; Oxc migration planned (develop trunk).
4. Turborepo+Bun-catalog monorepos (snug, animated-fluent-emojis): Oxc, Vitest, trunk `main`, 30 ADRs.
5. Legacy pnpm (api-codigos*, web-codigos*, smart-fan-web, marksy[Next15/Prisma6]): pre-standard, mostly archived/stale.
6. Non-TS: incense (Python/uv), smart-fan (C++/ESP-IDF), iphone-mcp (Swift), dotfiles (chezmoi, WSL+VPS), claude-forge (TS CLI, bun, github tracker, trunk main), andryore-private (brand/docs repo, Linear AO), Templates (fork, irrelevant).
Corrections to cross-repo consensus v2:
- C11 WRONG: @t3-oss/env is used in 6 repos (streamboss, sdnpanel, mail-sender, nfkit, nfkit-api, marksy) usually WITH dotenvx → env = `t3-env` + `dotenvx` modules; standard for apps with server env. (snug/AFE/web have neither.)
- O4 trunk: develop in streamboss, sdnpanel, andryore-web; main in snug, AFE, private, claude-forge → per-repo setting confirmed; aokit asks at create.
- TS7 alias: streamboss (Oxc origin) uses `typescript7` and `typescript: npm:@typescript/typescript6`; web's checked-in package.json uses `typescript7` too (@typescript/native only in web's new plan).
- Renovate in streamboss/sdnpanel/web/AFE/snug: rangeStrategy bump + automerge + minimumReleaseAge 3d (7d for some groups); pin only for oxc/typescript groups. ADR counts: streamboss 122, sdnpanel 120, snug 31, AFE 30, web 24.
- Dep default for aokit therefore: ranges (bump) + lockfile, pins for toolchain groups, Renovate config shipped as module. Q23 pin-all is contradicted by ALL active repos.
Module candidates from real usage: next, vite-react, astro, hono(+tsdown), prisma+pg, better-auth, t3-env, dotenvx, trigger.dev, posthog, next-intl, resend+react-email, base-ui, shadcn, tailwind4, docker+coolify, oxc, eslint-astro, commitlint+husky+lint-staged, knip, playwright+axe, vitest|bun-test, turborepo+catalog, renovate, adr-docs (CONTEXT/AGENTS/CLAUDE/forge). Non-TS stacks (python/c++/swift) out of scope v1.

## Reference-quality filter (Andry, 2026-11-03) — audit is NOT a copy source
- Reference repos = current best practice only: streamboss, snug, animated-fluent-emojis, andryore-web (+ sdnpanel as SaaS sibling). Older repos (mail-sender, nfkit, le-petit-prince, marksy, *-codigos*, smart-fan-web) are legacy: do NOT copy their choices.
- UI primitives: shadcn on **Base UI** (`@base-ui/react`), NOT Radix. No `radix-ui` module.
- Package manager: **Bun only**. No pnpm/npm support in generated projects → drop the package-manager abstraction (research gap #8) and pnpm-catalog/npm-fallback paths; Bun catalogs only for monorepo.
- Python/C++/Swift repos = experiments, permanently out of scope (not "later").
- Tooling follows the Oxc consensus (not mail-sender/nfkit ESLint+Prettier).
- Module catalog candidates (revised): next, vite-react, astro, hono(+tsdown), prisma+pg, better-auth, t3-env, dotenvx, trigger.dev, posthog, next-intl, resend+react-email, base-ui+shadcn, tailwind4, docker+coolify, oxc, eslint-astro, commitlint+husky+lint-staged, knip, playwright+axe, vitest|bun-test, turborepo+catalog, renovate, adr-docs.

## Pending
- Which other repo/changes to incorporate (user paused before domain-modeling).
- Then: domain-modeling (CONTEXT.md glossary terms), spec (S1..Sn), tickets, ExitPlanMode.

## Notes
- `forge init --help` ignored `--help` and ran init during plan mode: wrote forge.config.json (tracker local), docs/agents/*.md, .gitignore — uncommitted. TODO(forge) markers remain in docs/agents/forge.md.
- Research clones in session scratchpad (t3, bts).
