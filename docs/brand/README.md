# Brand kit

The identity of aokit, kept as code in the repository: documents, tokens, logo files, fonts, generated rasters and the terminal banner. Terms follow [GLOSSARY.md](../../GLOSSARY.md). The reasoning is in [ADR 0023](../adr/0023-brand-kit-in-docs-brand.md).

## Status

The identity is decided (2026-11-07) and the kit is in the repository. The exploration sheets are the record of how it was decided; the documents, tokens, logo files, fonts, rasters and banner are the result.

## Decisions

Each row is dated by the day it was approved, one canvas per part:

| Date       | Part    | Decision                                                                                                                                               | Exploration                                     |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 2026-11-07 | Palette | Soot, mono: dark first, no accent colour, the ink is the accent. Dark ground `#0f0f0f`, light ground `#f5f5f3`.                                        | [palette.html](explorations/palette.html)       |
| 2026-11-07 | Type    | Geist for the wordmark, headings and body, Geist Mono for code. Wordmark in Geist Medium (500), tracking -0.035em, lowercase.                          | [typography.html](explorations/typography.html) |
| 2026-11-07 | Logo    | Slot: a 2 by 2 grid of rounded Modules, three at 42 percent, the fourth solid and offset as if clicking into place.                                    | [logo.html](explorations/logo.html)             |
| 2026-11-07 | Copy    | Brand line "Projects from Modules. Updates that merge." with the plain line "A Bun-only CLI that creates TypeScript projects from composable Modules." | [copy.html](explorations/copy.html)             |

The palette and type rounds were rebuilt with the rules of Taste Skill (near-black ink, never pure black; one accent at most; no violet; text at 7:1 contrast). The first palette round, with cyan, violet, fuchsia and graphite options, is superseded by the second.

## Explorations

Standalone HTML sheets. They load Geist from Google Fonts, so open them with network access; the brandbook serves the fonts locally.

- [palette.html](explorations/palette.html): four Soot and Stone options with light and dark grades, computed contrast, cover mocks and the banner in a terminal.
- [typography.html](explorations/typography.html): four type pairings on the Soot palette with wordmark, README text, a glyph test and terminal output.
- [logo.html](explorations/logo.html): five marks with lockups, a size ladder down to 16 px, block-character banners and cover mocks.
- [copy.html](explorations/copy.html): brand line options, the README top, claims with their sources, metadata strings and voice rules.

## Documents

- [brief.md](brief.md): position, audience, what aokit is and is not, what to avoid.
- [naming.md](naming.md): why the name stays `aokit` and how it is written.
- [competitors.md](competitors.md): the neighbouring tools and where aokit differs, with sources.
- [voice.md](voice.md): voice rules, glossary terms and the avoid list.
- [copy.md](copy.md): the approved strings and the "Claims checked" table.
- [apply-spec.md](apply-spec.md): which asset feeds which surface, and what stays manual.

## Files

- [tokens.css](tokens.css): colour, type and spacing tokens as CSS custom properties.
- [logo/](logo/): the mark and the lockups as SVG, plus the `png/` rasters and `favicon.ico`.
- [brandbook/](brandbook/index.html): the brandbook page, with Geist and Geist Mono served locally from `brandbook/fonts/`.
- [og/](og/): the cover and social preview sources (`.html`) and their rendered `.png` files, in dark and light.
- [terminal/](terminal/): the banner as `banner.txt` and `banner.ansi`.
