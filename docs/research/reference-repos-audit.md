# Reference repos audit

Findings only: what Andry's repositories use today. The audit was done 2026-11-03 with `gh api` over 51 repos (about 20 active) plus peer-session replies (raw-notes.md L59-L95). `raw-notes.md` = [raw-notes.md](raw-notes.md). Repository URLs are under <https://github.com/AndryOre>; the notes give names, not full paths, so confirm exact names before linking deeper.

## Reference-quality filter

Per Andry (raw-notes.md L89-L95), only current best practice counts as a reference:

- Reference repos: streamboss, snug, animated-fluent-emojis, andryore-web, with sdnpanel as the SaaS sibling.
- UI primitives: shadcn on Base UI (`@base-ui/react`), not Radix.
- Package manager: Bun only.
- Tooling direction: Oxc, not the ESLint + Prettier of older repos.
- Legacy repos (mail-sender, nfkit, le-petit-prince, marksy, `*-codigos*`, smart-fan-web) are not copy sources.
- Python (incense), C++ (smart-fan) and Swift (iphone-mcp) repos are experiments and not copy sources.

## What each reference repo uses

| Repo | Stack today (raw-notes.md) | Trunk | ADRs |
| --- | --- | --- | --- |
| streamboss | Next 16, Prisma 7 (+pg adapter), better-auth, `@t3-oss/env-nextjs` + dotenvx, Trigger.dev, PostHog, next-intl, Base UI + shadcn, Tailwind 4, resend + react-email, Zod 4, Docker + Coolify, `bun test`, Playwright. Oxc origin: oxfmt 0.75, oxlint 1.90, tsgolint 7, `typescript: npm:@typescript/typescript6@6.0.2` plus alias `typescript7: npm:typescript@7.1.0-beta`, `parity/` gate (L75) | develop | 122 |
| sdnpanel | Same family as streamboss; still ESLint 10 + Prettier (L75) | develop | 120 |
| snug | Turborepo + Bun workspaces + catalog (`^` ranges, Renovate preserve-semver-ranges, deliberate), Tailwind v4 + shadcn + `@shadcn/lint`, ESLint + Prettier today with an Oxlint (`--type-aware`, jsPlugins aliases) + Oxfmt + TS 7.1 migration in progress (AO-2587), husky + lint-staged + commitlint, knip, Vitest, Playwright (+ axe, verified only in `apps/site`), `CONTEXT.md`, `docs/architecture.md`, root and per-workspace `AGENTS.md`, `CLAUDE.md` = `@AGENTS.md`, `.claude/skills` (L62) | main | 31 (L85; 30 in L62) |
| animated-fluent-emojis | Turborepo + Bun catalog monorepo, Oxc, Vitest (Vitest Browser Mode per L70) (L78, L70) | main | 30 |
| andryore-web | Single-package Astro 7 with React islands, ESLint strictTypeChecked + plugins, Prettier, husky/lint-staged/commitlint, knip, `bun test` + Playwright + axe, dotenvx only (no t3-env), Renovate ranges, `CLAUDE.md` = `@AGENTS.md`; Oxc migration planned (L61, L77) | develop | 24 |

ADR counts and trunk branches are from L85-L86; the snug count differs between L62 (30) and L85 (31) and is shown as the later figure.

## Families (raw-notes.md L74-L80)

1. Next.js SaaS: streamboss, sdnpanel.
2. Vite + React SPAs: mail-sender, nfkit, le-petit-prince (legacy filter applies; use `radix-ui`, ESLint + Prettier, no tests).
3. Astro: andryore-web.
4. Turborepo + Bun catalog monorepos: snug, animated-fluent-emojis.
5. Legacy pnpm: api-codigos*, web-codigos*, smart-fan-web, marksy.
6. Non-TypeScript and tooling repos: incense, smart-fan, iphone-mcp, dotfiles (chezmoi), claude-forge (TypeScript CLI, Bun, trunk main), andryore-private, Templates (fork, irrelevant).

## Renovate and ranges

In streamboss, sdnpanel, andryore-web, animated-fluent-emojis and snug, Renovate runs with `rangeStrategy: bump`, automerge and `minimumReleaseAge` of 3 days (7 days for some groups); exact pins apply only to the oxc and typescript groups (raw-notes.md L85). snug's `minimumReleaseAge` value was marked unverified by snug itself (L68).

## Cross-repo consensus and corrections

Consensus v2 came from four peer sessions (raw-notes.md L59-L71). Corrections found by the later audit and peer sign-offs:

| Topic | Earlier claim | Correction | Source |
| --- | --- | --- | --- |
| Env tooling | C11: no `@t3-oss/env` | Used in 6 repos (streamboss, sdnpanel, mail-sender, nfkit, nfkit-api, marksy), usually with dotenvx; snug, animated-fluent-emojis and web use neither | L82 |
| Trunk branch | one trunk | `develop` in streamboss, sdnpanel, andryore-web; `main` in snug, animated-fluent-emojis, andryore-private, claude-forge | L83 |
| TS 7 alias name | `@typescript/native` majority | streamboss uses `typescript7`; web's checked-in `package.json` uses `typescript7` too; `@typescript/native` appears only in web's new plan | L84 vs L68 |
| Dependency default | pin all (Q23) | Contradicted by every active repo: ranges (bump) + lockfile, pins for toolchain groups | L86, L68, L70 |
| ESLint companion | only `astro/*` rules | Must apply every rule the project config applies to `*.astro` (jsx-a11y 31, unicorn 330 via astro-eslint-parser); type-aware jsPlugin rules crash in Oxlint | L66 |
| Leaked conditional rendering | open (O3) | Minimal ESLint pass for `no-leaked-conditional-rendering` on `**/*.tsx`; shim only for repos without `.astro` | L68, L70 |
| Astro typecheck | content mapper in standard | Not agreed: snug saw 7 false errors on astro 7.3.5; use `astro check` on TS 6, mapper optional/experimental | L68 |
| Test runner | one runner | Per project: `bun test` (web, streamboss, sdnpanel) or Vitest (snug, animated-fluent-emojis) | L68, L70, L75-L78 |
| gitmoji | enforced | Convention; enforcement optional per repo | L68, L70 |
| Axe coverage | all repos | Verified only in snug's `apps/site` | L68 |

Known tooling gotchas reported by snug (L62): `@oxlint/migrate` produces broken config; Oxlint overrides lack `ignores`; jsPlugins context is frozen; `package.json` and `bun.lock` edits serialize forge tickets. Unverified claims: `@astrojs/compiler-rs` formatting `.astro` files (L61, L68) and the exact rule counts above beyond what peers reported.

## Module candidates observed

Derived from usage above (raw-notes.md L87, L95): next, vite-react, astro, hono (+ tsdown), prisma + pg, better-auth, t3-env, dotenvx, trigger.dev, posthog, next-intl, resend + react-email, base-ui + shadcn, tailwind4, docker + coolify, oxc, eslint-astro, commitlint + husky + lint-staged, knip, playwright + axe, vitest | bun-test, turborepo + catalog, renovate, adr-docs. This is a usage observation, not a roadmap; selections map to the [module catalog](../architecture/module-catalog.md).
