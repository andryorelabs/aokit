---
name: starlight-docs
description: Add or reorganize documentation pages in the Starlight docs site. Use when writing guides, reference pages or sidebar entries.
---

# Working with Starlight

1. Pages are Markdown or MDX files in `src/content/docs/`; a file there is a route (`guides/example.mdx` serves `/guides/example/`).
2. Every page starts with frontmatter that sets at least `title`; add `description` for search and link previews.
3. The integration is registered in `integrations` in `astro.config.ts`; set the site `title`, `sidebar` and social links in its options.
4. The collection is defined in `src/content.config.ts`; keep `docsLoader()` and `docsSchema()` there.
5. `src/pages/index.astro` is the landing page and takes precedence over a `src/content/docs/index.mdx` splash page.
6. Run `bun run dev` to preview and `bun run build` to produce the static site in `dist/`.
