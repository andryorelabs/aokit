---
name: astro-page
description: Add a page, a layout or a React island to the Astro web Target. Use when creating routes, shared layouts or interactive components.
---

# Working with Astro

1. Pages live in `src/pages/`; a file there is a route (`about.astro` serves `/about`).
2. Wrap every page in `src/layouts/Layout.astro` and pass it a `title`.
3. Interactive UI is a React component in `src/components/`, rendered in a page with a `client:*` directive (`client:load`, `client:idle`, `client:visible`). Without one it renders to static HTML only.
4. Stylesheets are imported from `src/styles.ts`, which `Layout.astro` loads; Modules register theirs there.
5. Register Astro integrations in `integrations` and Vite plugins in `plugins`, both in `astro.config.ts`.
6. Run `bun run dev` to preview and `bun run build` to produce the static site in `dist/`.
