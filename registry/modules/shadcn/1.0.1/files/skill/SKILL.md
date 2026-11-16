---
name: shadcn
description: Add and customize shadcn components on Base UI in this Project. Use when the user adds a component, changes a theme token, or runs `aokit add @shadcn/<item>`.
---

# shadcn on Base UI

This Project uses the shadcn component set on Base UI primitives, styled with Tailwind v4.

## Where things live

- `components.json` (web Target): shadcn configuration. Its aliases point at the shared-ui Target (`ui`, `lib`, `hooks`, `components`), the same places `aokit add` writes to.
- `ui/`, `lib/`, `hooks/`, `components/` under the shared-ui Target: copied-in component code, yours to edit. `lib/utils.ts` exports `cn` (`clsx` plus `tailwind-merge`).
- `src/styles.css` (web Target): the theme tokens (`:root`, `.dark`, `@theme`) and `tw-animate-css`.
- `ui/sonner.tsx`: the toast host; render `<Toaster />` once near the app root.

## Steps

1. Add a component with `aokit add @shadcn/<item>`, for example `aokit add @shadcn/dialog`. Do not run the shadcn CLI; aokit adapts the item and tracks it in the Lockfile.
2. Import it from the shared-ui Target and compose classes with `cn`.
3. Use `cva` (`class-variance-authority`) for variant props and `lucide-react` for icons.
4. Change colors by editing the CSS variables in `src/styles.css`, never by hardcoding colors in components.
5. Run `bun run dev` and check the component in the browser.

## Notes

- Components are built on Base UI (`@base-ui/react`), not Radix; use Base UI APIs such as the `render` prop instead of `asChild`.
- Items with CSS or theme changes need the `styling` Capability, which Tailwind v4 provides.
- An item the shadcn Registry changed upstream appears in `aokit update --plan`; it is never re-applied silently.
