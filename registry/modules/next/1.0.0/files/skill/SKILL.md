---
name: next
description: Work on the Next.js App Router web Target of this Project. Use when the user adds a page, layout, provider, stylesheet, proxy rule or next.config option.
---

# Next.js web Target

The web Target is a Next 16 App Router app with TypeScript and React Compiler on (`reactCompiler: true`).

## Where things live

- `src/app/layout.tsx`: the root layout. It imports `../styles` and wraps pages in `Providers`.
- `src/app/page.tsx`: the home page. Add routes as `src/app/<segment>/page.tsx`.
- `src/providers.tsx`: a client component. Register providers in the `providers` array (extension point `web.providers`).
- `src/styles.ts`: a list of side-effect imports (extension point `web.styles`), for example tailwind's `./styles.css`.
- `next.config.ts`: the `nextConfig` object (`next.config`) and the `plugins` array (`next.plugins`) of `(config) => config` wrappers.
- `src/proxy.ts`: the Next 16 replacement for `middleware.ts`. Exactly one Module owns it; a Module that needs it declares an override.

## Steps

1. Add a page by creating `src/app/<segment>/page.tsx` with a default export.
2. Keep server components the default; add `"use client"` only where state, effects or browser APIs are needed.
3. Add global styles by importing them from `src/styles.ts`, never from individual pages.
4. Run `bun run dev` and open the route to check it.

## Notes

- Do not add `useMemo` or `useCallback` for performance; React Compiler handles it.
- Use `src/proxy.ts`, not `middleware.ts`, for request interception.
- Files marked managed (`next.config.ts`, `src/app/layout.tsx`, `src/providers.tsx`, `src/styles.ts`, `src/proxy.ts`) are updated through extension points; prefer those over hand edits.
